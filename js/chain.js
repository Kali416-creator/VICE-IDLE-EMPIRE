/* =====================================================================
 * VICE IDLE · NEON EMPIRE — js/chain.js
 * MetaMask + ethers v6 cargado de forma perezosa (lazy).
 *
 * - Sin red: el juego funciona igual; aquí solo se conecta la cartera.
 * - El cliente nunca decide un pago: llama al contrato y espera su evento.
 * - Si no hay ethers disponible (fichero autocontenido, sin CDN) las
 *   funciones de escritura devuelven { ok:false, reason:'no_ethers' } y la
 *   UI explica que hace falta la build con ethers o una RPC configurada.
 * ===================================================================== */
(function (root) {
  'use strict';

  // Configuración por red. Cambiar aquí para mainnet/testnet.
  var CHAINS = {
    bsc: {
      id: 56, name: 'BNB Smart Chain', hex: '0x38',
      rpc: 'https://bsc-dataseed.binance.org',
      explorer: 'https://bscscan.com',
      usdt: '0x55d398326f99059fF775485246999027B3197955'
    },
    bscTestnet: {
      id: 97, name: 'BNB Smart Chain Testnet', hex: '0x61',
      rpc: 'https://data-seed-prebsc-1-s1.binance.org:8545',
      explorer: 'https://testnet.bscscan.com',
      usdt: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd'
    },
    hardhat: {
      id: 31337, name: 'Hardhat', hex: '0x7a69',
      rpc: 'http://127.0.0.1:8545',
      explorer: '',
      usdt: '0x0000000000000000000000000000000000000000'
    }
  };

  var VARIANTS = {
    viceIdleVault: 'ViceIdleVault',
    viceSwapVault: 'ViceSwapVault'
  };

  var state = {
    provider: null,
    signer: null,
    account: null,
    chainId: null,
    ethers: null,
    contracts: {},          // chainId -> { vault, swap, usdt }
    ready: false
  };

  function cfg(network) {
    return CHAINS[network || 'bscTestnet'];
  }

  /** Red activa: la del jugador si existe, si no testnet. */
  function activeNetwork() {
    var pref = null;
    try { pref = root.localStorage.getItem('viceIdle_network'); } catch (e) { /* ignore */ }
    return (pref && CHAINS[pref]) ? pref : 'bscTestnet';
  }

  function setNetwork(n) {
    if (!CHAINS[n]) return false;
    try { root.localStorage.setItem('viceIdle_network', n); } catch (e) { /* ignore */ }
    state.contracts = {};
    return true;
  }

  /* ---------------- direcciones desplegadas ---------------- */

  /**
   * Las direcciones se cargan del fichero de despliegue del repo
   * (contracts/deployments/<red>.json) cuando se sirve desde el repo.
   * En el HTML autocontenido se inyectan en window.VICE_DEPLOYMENTS.
   */
  function deployments() {
    return root.VICE_DEPLOYMENTS || (state.contracts.__deployments || null);
  }

  function setDeployments(obj) {
    root.VICE_DEPLOYMENTS = obj || null;
    state.contracts = {};
  }

  function addresses(network) {
    var d = deployments();
    if (!d) return null;
    var n = d[network || activeNetwork()];
    if (!n) return null;
    return n;
  }

  /* ---------------- ethers (lazy) ---------------- */

  /**
   * ethers v6 UMD se puede cargar desde:
   *  1) window.ethers (ya cargado)
   *  2) window.VICE_ETHERS_UMD (texto del bundle inyectado por el build)
   *  3) el fichero vendor/ethers.umd.min.js si está servido
   * Si no hay nada de eso, no se rompe nada: devuelve null.
   */
  function loadEthers() {
    if (state.ethers) return Promise.resolve(state.ethers);
    if (root.ethers && root.ethers.JsonRpcProvider) { state.ethers = root.ethers; return Promise.resolve(root.ethers); }
    if (typeof root.VICE_ETHERS_UMD === 'string' && root.VICE_ETHERS_UMD.length > 1000) {
      try {
        // eslint-disable-next-line no-new-func
        var mod = { exports: {} };
        var fn = new Function('module', 'exports', root.VICE_ETHERS_UMD);
        fn(mod, mod.exports);
        var e = mod.exports && (mod.exports.ethers || mod.exports);
        if (e && e.JsonRpcProvider) { state.ethers = e; root.ethers = e; return Promise.resolve(e); }
      } catch (err) {
        if (root.console) console.warn('[chain] no se pudo evaluar el bundle de ethers', err);
      }
    }
    if (typeof document !== 'undefined' && typeof root.fetch === 'function') {
      return root.fetch('vendor/ethers.umd.min.js').then(function (r) {
        if (!r.ok) return null;
        return r.text();
      }).then(function (txt) {
        if (!txt) return null;
        var mod = { exports: {} };
        // eslint-disable-next-line no-new-func
        new Function('module', 'exports', txt)(mod, mod.exports);
        var e = mod.exports && (mod.exports.ethers || mod.exports);
        if (e && e.JsonRpcProvider) { state.ethers = e; root.ethers = e; return e; }
        return null;
      }).catch(function () { return null; });
    }
    return Promise.resolve(null);
  }

  /* ---------------- conexión ---------------- */

  function hasWallet() {
    return !!(root.ethereum && typeof root.ethereum.request === 'function');
  }

  function connect() {
    if (!hasWallet()) return Promise.resolve({ ok: false, reason: 'no_wallet' });
    return root.ethereum.request({ method: 'eth_requestAccounts' }).then(function (accounts) {
      state.account = (accounts && accounts[0]) || null;
      if (!state.account) return { ok: false, reason: 'no_account' };
      return root.ethereum.request({ method: 'eth_chainId' }).then(function (hex) {
        state.chainId = parseInt(hex, 16);
        return loadEthers();
      }).then(function (ethers) {
        if (ethers && root.ethereum) {
          var BrowserProvider = ethers.BrowserProvider || ethers.providers && ethers.providers.Web3Provider;
          if (BrowserProvider) {
            state.provider = new BrowserProvider(root.ethereum);
            return state.provider.getSigner().then(function (s) { state.signer = s; });
          }
        }
        return null;
      }).then(function () {
        state.ready = true;
        return { ok: true, account: state.account, chainId: state.chainId, ethers: !!state.ethers };
      });
    }).catch(function (err) {
      return { ok: false, reason: 'rejected', error: err && err.message };
    });
  }

  function disconnect() {
    state.provider = null; state.signer = null; state.account = null; state.ready = false;
    return { ok: true };
  }

  function networkName(chainId) {
    var keys = Object.keys(CHAINS);
    for (var i = 0; i < keys.length; i++) if (CHAINS[keys[i]].id === chainId) return keys[i];
    return null;
  }

  function ensureChain(network) {
    var net = cfg(network || activeNetwork());
    if (!hasWallet()) return Promise.resolve({ ok: false, reason: 'no_wallet' });
    return root.ethereum.request({ method: 'eth_chainId' }).then(function (hex) {
      if (parseInt(hex, 16) === net.id) return { ok: true };
      return root.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: net.hex }]
      }).catch(function (err) {
        if (err && err.code === 4902) {
          return root.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: net.hex, chainName: net.name,
              nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
              rpcUrls: [net.rpc], blockExplorerUrls: net.explorer ? [net.explorer] : []
            }]
          });
        }
        throw err;
      }).then(function () { return { ok: true, switched: true }; });
    }).catch(function (err) {
      return { ok: false, reason: 'chain_switch', error: err && err.message };
    });
  }

  /* ---------------- contratos ---------------- */

  var ABI_VAULT = [
    'function buyVip(uint8 planIndex) external',
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function vipUntil(address) view returns (uint256)',
    'function plans(uint256) view returns (uint256 numDays, uint256 priceUsdt)',
    'event VipPurchased(address indexed player, uint8 planIndex, uint256 numDays, uint256 paid)'
  ];

  var ABI_SWAP = [
    'function claimSwapWithSig(address player, uint256 greedAmount, uint256 usdtAmount, uint256 deadline, uint256 nonce, bytes signature) external',
    'function nonces(address) view returns (uint256)',
    'function epochRate() view returns (uint256)',
    'event SwapClaimed(address indexed player, uint256 greedAmount, uint256 usdtAmount, uint256 nonce)'
  ];

  function contract(kind, network) {
    var net = network || activeNetwork();
    var addrs = addresses(net);
    if (!addrs) return Promise.resolve({ ok: false, reason: 'no_deployment' });
    if (!state.ethers) return Promise.resolve({ ok: false, reason: 'no_ethers' });
    if (!state.signer) return Promise.resolve({ ok: false, reason: 'no_wallet' });
    var addr = kind === 'swap' ? addrs.viceSwapVault : addrs.viceIdleVault;
    if (!addr) return Promise.resolve({ ok: false, reason: 'no_address' });
    var abi = kind === 'swap' ? ABI_SWAP : ABI_VAULT;
    try {
      var c = new state.ethers.Contract(addr, abi, state.signer);
      return Promise.resolve({ ok: true, contract: c, address: addr });
    } catch (e) {
      return Promise.resolve({ ok: false, reason: 'contract', error: e && e.message });
    }
  }

  /* ---------------- VIP ---------------- */

  /**
   * Compra un pase VIP. planIndex: 0 | 1 | 2.
   * Requiere: cartera conectada, red correcta, contratos desplegados.
   */
  function buyVip(planIndex) {
    return ensureChain().then(function (ch) {
      if (!ch.ok) return ch;
      return connect();
    }).then(function (conn) {
      if (!conn || conn.ok === false) return conn || { ok: false, reason: 'no_wallet' };
      return contract('vault');
    }).then(function (c) {
      if (!c.ok) return c;
      // Approve del USDT por el importe del plan (si el contrato lo requiere)
      return c.contract.buyVip(planIndex).then(function (tx) {
        return tx.wait().then(function (rc) {
          return { ok: true, hash: rc && rc.hash ? rc.hash : (tx.hash || null) };
        });
      });
    }).catch(function (err) {
      return { ok: false, reason: 'tx', error: err && (err.shortMessage || err.message) };
    });
  }

  /* ---------------- claim del swap ---------------- */

  /**
   * Reclama un voucher firmado por el relayer.
   * voucher: { player, greed, usdt, deadline, nonce, signature }
   */
  function claimSwap(voucher) {
    if (!voucher) return Promise.resolve({ ok: false, reason: 'no_voucher' });
    return ensureChain().then(function (ch) {
      if (!ch.ok) return ch;
      return connect();
    }).then(function (conn) {
      if (!conn || conn.ok === false) return conn || { ok: false, reason: 'no_wallet' };
      return contract('swap');
    }).then(function (c) {
      if (!c.ok) return c;
      return c.contract.claimSwapWithSig(
        voucher.player, voucher.greed, voucher.usdt, voucher.deadline, voucher.nonce, voucher.signature
      ).then(function (tx) {
        return tx.wait().then(function (rc) {
          return { ok: true, hash: (rc && rc.hash) || tx.hash };
        });
      });
    }).catch(function (err) {
      return { ok: false, reason: 'tx', error: err && (err.shortMessage || err.message) };
    });
  }

  /* ---------------- lecturas ---------------- */

  function readVipUntil(account) {
    return contract('vault').then(function (c) {
      if (!c.ok) return c;
      return c.contract.vipUntil(account || state.account).then(function (v) {
        return { ok: true, vipUntil: Number(v) * 1000 };
      });
    }).catch(function (err) { return { ok: false, error: err && err.message }; });
  }

  var Chain = {
    CHAINS: CHAINS,
    state: state,
    cfg: cfg,
    activeNetwork: activeNetwork,
    setNetwork: setNetwork,
    deployments: deployments,
    setDeployments: setDeployments,
    addresses: addresses,
    loadEthers: loadEthers,
    hasWallet: hasWallet,
    connect: connect,
    disconnect: disconnect,
    networkName: networkName,
    ensureChain: ensureChain,
    buyVip: buyVip,
    claimSwap: claimSwap,
    readVipUntil: readVipUntil,
    explorerTx: function (hash) {
      var net = cfg();
      return net.explorer ? net.explorer + '/tx/' + hash : null;
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Chain;
  root.Chain = Chain;
})(typeof window !== 'undefined' ? window : globalThis);
