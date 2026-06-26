/* ================================================================
   CONTROL DE ACCESO NFC — LÓGICA DE LA APLICACIÓN
   --------------------------------------------------------------
   Este archivo controla toda la interactividad:
     1. Reloj en tiempo real
     2. Simulación de lectura NFC (autorizado / denegado)
     3. Reproducción de sonidos (generados con Web Audio API)
     4. Actualización de estadísticas del dashboard
     5. Historial de accesos
     6. Modo demostración (flujo completo paso a paso)
   ================================================================ */


/* ================================================================
   0. REFERENCIAS A ELEMENTOS DEL DOM
   ================================================================ */
const $ = (id) => document.getElementById(id);

const liveClock       = $('liveClock');
const statAuthorized  = $('statAuthorized');
const statDenied      = $('statDenied');
const statVehicles    = $('statVehicles');

// Estados de la pantalla del lector
const stateIdle       = $('stateIdle');
const stateReading    = $('stateReading');
const stateAuthorized = $('stateAuthorized');
const stateDenied     = $('stateDenied');

// Botones
const btnSimulate     = $('btnSimulate');
const btnDemoFlow     = $('btnDemoFlow');
const btnClearHistory = $('btnClearHistory');
const themeToggle     = $('themeToggle');

// Cuerpo del historial
const historyBody     = $('historyBody');
const historyEmpty    = $('historyEmpty');

// Pasos del flujo de demostración
const flowSteps       = $('flowSteps');


/* ================================================================
   1. CONTADORES Y DATOS DE EJEMPLO
   ================================================================ */
let authorizedCount = 0;   // Accesos autorizados hoy
let deniedCount     = 0;   // Accesos rechazados hoy

// Base de datos simulada de residentes autorizados.
// Al autorizar, se elige uno al azar de esta lista.
const residentsDB = [
    { name: 'Juan Perez',     apt: 'Torre A - 302', vehicle: 'Mazda CX-30 gris',      plate: 'KLM 482', status: 'Activo' },
    { name: 'Maria Gomez',    apt: 'Torre B - 105', vehicle: 'Toyota Corolla blanco', plate: 'RZX 914', status: 'Activo' },
    { name: 'Carlos Ruiz',    apt: 'Torre A - 418', vehicle: 'Renault Duster azul',   plate: 'HBT 227', status: 'Activo' },
    { name: 'Ana Torres',     apt: 'Torre C - 220', vehicle: 'Kia Picanto rojo',      plate: 'NQP 631', status: 'Activo' },
    { name: 'Luis Fernandez', apt: 'Torre B - 310', vehicle: 'Chevrolet Onix negro',  plate: 'VCD 708', status: 'Activo' },
];

statVehicles.textContent = residentsDB.length * 17 + 1;


/* ================================================================
   2. UTILIDADES DE FECHA Y HORA
   ================================================================ */

// Devuelve la hora actual en formato HH:MM:SS (para el reloj en vivo)
function formatTime(date) {
    return date.toLocaleTimeString('es-ES', { hour12: false });
}

// Devuelve la fecha en formato dd/mm/aaaa
function formatDate(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

// Reloj en tiempo real: actualiza cada segundo la barra superior
function tickClock() {
    liveClock.textContent = formatTime(new Date());
}
setInterval(tickClock, 1000);
tickClock(); // llamada inicial para no esperar 1s


/* ================================================================
   2.1 CAMBIO DE TEMA
   --------------------------------------------------------------
   Alterna entre tema claro y oscuro, y recuerda la elección del
   usuario para próximas visitas.
   ================================================================ */
const THEME_STORAGE_KEY = 'secureAccessTheme';

function getCurrentTheme() {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function updateThemeControl(theme) {
    const isDark = theme === 'dark';
    themeToggle.setAttribute('aria-checked', String(isDark));
    themeToggle.setAttribute('aria-label', isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
    themeToggle.title = isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
}

function setTheme(theme, persist = true) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    updateThemeControl(theme);

    if (persist) {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
}

function toggleTheme() {
    const nextTheme = getCurrentTheme() === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
}

updateThemeControl(getCurrentTheme());


/* ================================================================
   3. SONIDOS (Web Audio API — sin archivos externos)
   --------------------------------------------------------------
   Generamos tonos sintéticos: uno alegre para éxito
   y uno corto y grave para error.
   ================================================================ */
let audioCtx = null;

// Crea el contexto de audio de forma perezosa (requiere interacción)
function getAudioCtx() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
}

// Reproduce un tono con frecuencia y duración definidas
function playTone(freq, duration, type = 'sine', delay = 0) {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);

    const start = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.start(start);
    osc.stop(start + duration);
}

// Sonido de ÉXITO: dos tonos ascendentes (C5 → E6)
function playSuccessSound() {
    playTone(523.25, 0.18, 'sine', 0);      // Do
    playTone(659.25, 0.18, 'sine', 0.12);   // Mi
    playTone(783.99, 0.30, 'sine', 0.24);   // Sol agudo
}

// Sonido de ERROR: dos tonos graves descendentes (tipo "buzzer")
function playErrorSound() {
    playTone(311.13, 0.22, 'square', 0);    // Mi bemol grave
    playTone(233.08, 0.35, 'square', 0.20); // Si bemol más grave
}


/* ================================================================
   4. GENERACIÓN DE UID ALEATORIO
   --------------------------------------------------------------
   Genera un identificador hexadecimal de 14 caracteres,
   imitando el UID real de una tarjeta NFC/MIFARE.
   ================================================================ */
function generateUID() {
    const chars = '0123456789ABCDEF';
    let uid = '';
    for (let i = 0; i < 14; i++) {
        uid += chars[Math.floor(Math.random() * chars.length)];
    }
    return uid;
}

function generatePlate() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    let plate = '';

    for (let i = 0; i < 3; i++) {
        plate += letters[Math.floor(Math.random() * letters.length)];
    }

    plate += ' ';

    for (let i = 0; i < 3; i++) {
        plate += numbers[Math.floor(Math.random() * numbers.length)];
    }

    return plate;
}


/* ================================================================
   5. CONTROL DE ESTADOS DEL LECTOR
   --------------------------------------------------------------
   Muestra únicamente el estado indicado y oculta los demás.
   ================================================================ */
const allStates = [stateIdle, stateReading, stateAuthorized, stateDenied];

function showState(state) {
    allStates.forEach(s => s.classList.remove('is-active'));
    state.classList.add('is-active');
}


/* ================================================================
   6. SIMULACIÓN DE LECTURA NFC
   --------------------------------------------------------------
   Flujo:
     1. Estado "Leyendo tarjeta..." (2 segundos)
     2. Resultado aleatorio: 70% autorizado, 30% denegado
     3. Actualiza dashboard e historial
   ================================================================ */
function simulateRead() {
    btnSimulate.disabled = true;       // evita doble lectura
    showState(stateReading);           // muestra animación de lectura

    // Tras 2 segundos, se muestra el resultado
    setTimeout(() => {
        const isAuthorized = Math.random() < 0.7;   // 70% de éxito
        if (isAuthorized) {
            showAuthorized();
        } else {
            showDenied();
        }
        btnSimulate.disabled = false;
    }, 2000);
}

// ---- CASO 1: RESIDENTE AUTORIZADO ----
function showAuthorized() {
    const resident = residentsDB[Math.floor(Math.random() * residentsDB.length)];
    const uid = generateUID();
    const now = new Date();

    // Rellenamos los datos de la tarjeta verde
    $('resName').textContent     = resident.name;
    $('resApt').textContent      = resident.apt;
    $('resVehicle').textContent  = resident.vehicle;
    $('resPlate').textContent    = resident.plate;
    $('resStatus').textContent   = resident.status;
    $('resUid').textContent      = uid;
    $('resDateTime').textContent = `${formatDate(now)} · ${formatTime(now)}`;

    showState(stateAuthorized);
    playSuccessSound();   // sonido de éxito

    // Actualiza contadores e historial
    authorizedCount++;
    statAuthorized.textContent = authorizedCount;
    addHistoryRow(uid, true, now, resident.plate, resident.vehicle);
}

// ---- CASO 2: TARJETA NO REGISTRADA ----
function showDenied() {
    const uid = generateUID();
    const plate = generatePlate();
    const now = new Date();

    $('denPlate').textContent    = plate;
    $('denUid').textContent      = uid;
    $('denDateTime').textContent = `${formatDate(now)} · ${formatTime(now)}`;

    showState(stateDenied);
    playErrorSound();   // sonido de error

    // Actualiza contadores e historial
    deniedCount++;
    statDenied.textContent = deniedCount;
    addHistoryRow(uid, false, now, plate, 'No registrado');
}


/* ================================================================
   7. HISTORIAL DE ACCESOS
   --------------------------------------------------------------
   Agrega una fila nueva a la tabla por cada lectura.
   ================================================================ */
function addHistoryRow(uid, authorized, date) {
    // Si existe la fila vacía inicial, se elimina
    if (historyEmpty) historyEmpty.remove();

    const row = document.createElement('tr');
    row.classList.add('is-new');   // animación de entrada

    // Badge según el resultado
    const badge = authorized
        ? '<span class="badge badge--success">✓ Autorizado</span>'
        : '<span class="badge badge--danger">✗ Denegado</span>';

    row.innerHTML = `
        <td>${formatDate(date)}</td>
        <td class="mono">${formatTime(date)}</td>
        <td class="mono">${uid}</td>
        <td>${badge}</td>
    `;

    // Las filas más recientes aparecen arriba
    historyBody.insertBefore(row, historyBody.firstChild);

    // Limita el historial a 50 registros para no saturar la demo
    while (historyBody.children.length > 50) {
        historyBody.removeChild(historyBody.lastChild);
    }
}

// Limpia completamente el historial
function clearHistory() {
    historyBody.innerHTML = `
        <tr class="history__empty" id="historyEmpty">
            <td colspan="4">Aún no se han registrado accesos.</td>
        </tr>
    `;
}


/* ================================================================
   8. MODO DEMOSTRACIÓN — FLUJO COMPLETO
   --------------------------------------------------------------
   Resalta paso a paso los 4 estados del proceso:
     1. Tarjeta NFC detectada
     2. Consulta a la base de datos
     3. Validación de residente
     4. Acceso autorizado
   ================================================================ */
async function runDemoFlow() {
    const steps = flowSteps.querySelectorAll('.flow__step');
    btnDemoFlow.disabled = true;

    // Reinicia el estado visual de todos los pasos
    steps.forEach(s => s.classList.remove('is-active', 'is-done'));

    // Recorre cada paso con una pausa de 1 segundo entre ellos
    for (let i = 0; i < steps.length; i++) {
        steps[i].classList.add('is-active');
        await wait(1000);

        // Marca como completado (verde) y continúa
        steps[i].classList.remove('is-active');
        steps[i].classList.add('is-done');
    }

    // Breve confirmación final
    playSuccessSound();
    btnDemoFlow.disabled = false;
}

// Promesa que espera N milisegundos (utilidad para el flujo)
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


/* ================================================================
   9. ASIGNACIÓN DE EVENTOS
   ================================================================ */
btnSimulate.addEventListener('click', simulateRead);
btnDemoFlow.addEventListener('click', runDemoFlow);
btnClearHistory.addEventListener('click', clearHistory);
themeToggle.addEventListener('click', toggleTheme);

// Estado inicial: lector en espera
showState(stateIdle);
