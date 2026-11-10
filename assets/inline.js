/* =====================================================================
 * VICE IDLE · NEON EMPIRE — assets/inline.js
 * Datos inyectados por el build (tools/build.js). Sin nada aquí, el juego
 * funciona igual: conexión en la nube opcional y despliegues vacíos.
 *
 * Se define con `var` para poder sobrescribirse desde el HTML generado.
 * ===================================================================== */
var VICE_BUILD = {
  version: '4.5.0',
  mode: 'dev',            // 'dev' (multiarchivo) | 'single' (vice-idle.html)
  singleFile: false,
  date: null
};

/* Conexión por defecto con el BACKEND del juego (marcador y retiros).
 * El build la rellena desde .env.local. null = sin conexión por defecto. */
var VICE_CLOUD_DEFAULT = null;

/* Direcciones desplegadas de los contratos por red (contracts/deployments/*.json). */
var VICE_DEPLOYMENTS = null;

/* Bundle UMD de ethers v6 para la build autocontenida (opcional). */
var VICE_ETHERS_UMD = null;
