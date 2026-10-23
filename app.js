"use strict";

/*
  All computation runs in the browser (sim-engine.js) — no backend call.
  Timing is kept identical to the former backend version:
  0.09 × speed simulated time units every 180 ms of real time.
*/
const STEP_REAL_MS = 180;
const BASE_SIMULATED_DELTA = 0.09;
const MAX_FRAME_MS = 250;   // a tab that was hidden does not jump far ahead
const XLSX_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";

const lambdaInput = document.getElementById("lambdaInput");
const intervalInput = document.getElementById("intervalInput");
const speedInput = document.getElementById("speedInput");
const maxCountInput = document.getElementById("maxCountInput");
const binInput = document.getElementById("binInput");
const message = document.getElementById("message");
const apiStatus = document.getElementById("apiStatus");

const timeMetric = document.getElementById("timeMetric");
const currentCountMetric = document.getElementById("currentCountMetric");
const intervalSamplesMetric = document.getElementById("intervalSamplesMetric");
const waitingSamplesMetric = document.getElementById("waitingSamplesMetric");
const meanCountMetric = document.getElementById("meanCountMetric");
const theoreticalCountMetric = document.getElementById("theoreticalCountMetric");
const meanWaitingMetric = document.getElementById("meanWaitingMetric");
const theoreticalWaitingMetric = document.getElementById("theoreticalWaitingMetric");

const startButton = document.getElementById("startButton");
const pauseButton = document.getElementById("pauseButton");
const resetButton = document.getElementById("resetButton");
const exportButton = document.getElementById("exportButton");

const poissonCanvas = document.getElementById("poissonCanvas");
const poissonContext = poissonCanvas.getContext("2d");
const exponentialCanvas = document.getElementById("exponentialCanvas");
const exponentialContext = exponentialCanvas.getContext("2d");

let simulation = null;
let snapshot = null;
let frameId = null;
let lastFrameTime = null;
let speed = 1;

function setMessage(text, success = false) {
  message.textContent = text;
  message.className = success ? "success" : "";
}

function setApiStatus(text, stateName) {
  apiStatus.textContent = text;
  apiStatus.className = `status-badge ${stateName}`;
}

function getParameters() {
  const parameters = {
    lambda_rate: Number(lambdaInput.value),
    interval_length: Number(intervalInput.value),
    max_count: Number(maxCountInput.value),
    number_of_bins: Number(binInput.value)
  };
  const speedValue = Number(speedInput.value);

  try {
    PoissonEngine.validateParameters(parameters);
  } catch (error) {
    setMessage(error.message);
    return null;
  }
  if (!Number.isFinite(speedValue) || speedValue <= 0) {
    setMessage("Animation speed must be greater than zero.");
    return null;
  }

  setMessage("");
  return { parameters, speed: speedValue };
}

function createSession() {
  const values = getParameters();
  if (!values) return false;
  simulation = new PoissonEngine.PoissonSimulation(values.parameters);
  speed = values.speed;
  snapshot = simulation.snapshot();
  renderSnapshot(snapshot);
  return true;
}

function resetSimulation() {
  pauseSimulation();
  simulation = null;
  snapshot = null;
  if (createSession()) setMessage("Simulation reset.", true);
}

function animationFrame(now) {
  if (lastFrameTime === null) lastFrameTime = now;
  const elapsed = Math.min(now - lastFrameTime, MAX_FRAME_MS);
  lastFrameTime = now;

  try {
    simulation.step(BASE_SIMULATED_DELTA * speed * (elapsed / STEP_REAL_MS));
    snapshot = simulation.snapshot();
    renderSnapshot(snapshot);
  } catch (error) {
    pauseSimulation();
    setMessage(`Simulation failed: ${error.message}`);
    return;
  }
  frameId = window.requestAnimationFrame(animationFrame);
}

function startSimulation() {
  if (!simulation && !createSession()) return;
  const values = getParameters();
  if (!values) return;
  speed = values.speed;

  if (frameId !== null) return;
  setMessage("Simulation running…", true);
  lastFrameTime = null;
  frameId = window.requestAnimationFrame(animationFrame);
}

function pauseSimulation() {
  if (frameId !== null) {
    window.cancelAnimationFrame(frameId);
    frameId = null;
  }
  lastFrameTime = null;
}

let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxLoading) {
    xlsxLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = XLSX_URL;
      script.onload = () => resolve(window.XLSX);
      script.onerror = () => { xlsxLoading = null; reject(new Error("could not load the Excel library (check the internet connection)")); };
      document.head.appendChild(script);
    });
  }
  return xlsxLoading;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function exportResultsToExcel() {
  if (!simulation) {
    setMessage("Start or reset the simulation first.");
    return;
  }

  pauseSimulation();
  exportButton.disabled = true;
  try {
    setMessage("Preparing the Excel file…", true);
    const XLSX = await loadXlsx();
    const workbook = XLSX.utils.book_new();
    for (const sheet of simulation.workbookSheets()) {
      const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
      ws["!cols"] = sheet.widths.map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(workbook, ws, sheet.name);
    }
    const fileName = `Poisson_Exponential_Results_${timestamp()}.xlsx`;
    XLSX.writeFile(workbook, fileName, { compression: true });
    setMessage(`Results exported: ${fileName}`, true);
  } catch (error) {
    setMessage(`Excel export failed: ${error.message}`);
  } finally {
    exportButton.disabled = false;
  }
}

function renderSnapshot(data) {
  updateMetrics(data);
  drawPoissonAnimation(data);
  drawExponentialAnimation(data);
  updatePoissonChart(data);
  updateExponentialChart(data);
}

function updateMetrics(data) {
  const m = data.metrics;
  timeMetric.textContent = data.simulation_time.toFixed(2);
  currentCountMetric.textContent = data.current_interval_count;
  intervalSamplesMetric.textContent = data.interval_counts.length;
  waitingSamplesMetric.textContent = data.interarrival_times.length;
  meanCountMetric.textContent = m.observed_mean_count.toFixed(3);
  theoreticalCountMetric.textContent = m.theoretical_mean_count.toFixed(3);
  meanWaitingMetric.textContent = m.observed_mean_waiting.toFixed(3);
  theoreticalWaitingMetric.textContent = m.theoretical_mean_waiting.toFixed(3);
}

const poissonChart = new Chart(document.getElementById("poissonChart").getContext("2d"), {
  type: "bar",
  data: { labels: [], datasets: [
    { label: "Observed proportion", data: [], borderWidth: 1 },
    { label: "Theoretical Poisson probability", data: [], type: "line", borderWidth: 2, pointRadius: 3, tension: 0.15 }
  ]},
  options: { responsive: true, maintainAspectRatio: false, animation: false, scales: {
    x: { title: { display: true, text: "Number of events k" } },
    y: { beginAtZero: true, title: { display: true, text: "Probability" } }
  }}
});

const exponentialChart = new Chart(document.getElementById("exponentialChart").getContext("2d"), {
  type: "bar",
  data: { labels: [], datasets: [
    { label: "Observed histogram density", data: [], borderWidth: 1, barPercentage: 1, categoryPercentage: 1 },
    { label: "Theoretical Exponential density", data: [], type: "line", borderWidth: 2, pointRadius: 0, tension: 0.2 }
  ]},
  options: { responsive: true, maintainAspectRatio: false, animation: false, scales: {
    x: { title: { display: true, text: "Interarrival time x" } },
    y: { beginAtZero: true, title: { display: true, text: "Probability density" } }
  }}
});

function updatePoissonChart(data) {
  poissonChart.data.labels = data.poisson_distribution.labels;
  poissonChart.data.datasets[0].data = data.poisson_distribution.observed;
  poissonChart.data.datasets[1].data = data.poisson_distribution.theoretical;
  poissonChart.update("none");
}

function updateExponentialChart(data) {
  exponentialChart.data.labels = data.exponential_histogram.labels;
  exponentialChart.data.datasets[0].data = data.exponential_histogram.observed_densities;
  exponentialChart.data.datasets[1].data = data.exponential_histogram.theoretical_densities;
  exponentialChart.update("none");
}

function drawPoissonAnimation(data) {
  const ctx = poissonContext;
  const width = poissonCanvas.width;
  const height = poissonCanvas.height;
  const intervalLength = data.parameters.interval_length;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#20242a";
  ctx.font = "15px Arial";
  ctx.fillText("Current fixed interval", 25, 28);

  const left = 40;
  const right = width - 35;
  const centerY = 125;
  const lineWidth = right - left;

  ctx.strokeStyle = "#555";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(left, centerY); ctx.lineTo(right, centerY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(left, centerY - 25); ctx.lineTo(left, centerY + 25); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(right, centerY - 25); ctx.lineTo(right, centerY + 25); ctx.stroke();

  ctx.fillStyle = "#333";
  ctx.fillText(data.current_interval_start.toFixed(1), left - 12, centerY + 48);
  ctx.fillText((data.current_interval_start + intervalLength).toFixed(1), right - 15, centerY + 48);

  const progress = Math.min(1, Math.max(0, (data.simulation_time - data.current_interval_start) / intervalLength));
  ctx.strokeStyle = "#1769d2";
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(left, centerY - 55); ctx.lineTo(left + progress * lineWidth, centerY - 55); ctx.stroke();

  ctx.fillStyle = "#1769d2";
  for (const arrivalTime of data.recent_arrival_times) {
    if (arrivalTime >= data.current_interval_start && arrivalTime < data.current_interval_start + intervalLength) {
      const x = left + ((arrivalTime - data.current_interval_start) / intervalLength) * lineWidth;
      ctx.beginPath(); ctx.arc(x, centerY, 7, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = "#1769d2"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, centerY - 20); ctx.lineTo(x, centerY + 20); ctx.stroke();
    }
  }

  ctx.fillStyle = "#20242a";
  ctx.font = "bold 28px Arial";
  ctx.fillText(`Count = ${data.current_interval_count}`, 205, 215);
}

function drawExponentialAnimation(data) {
  const ctx = exponentialContext;
  const width = exponentialCanvas.width;
  const height = exponentialCanvas.height;
  const lambda = data.parameters.lambda_rate;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#20242a";
  ctx.font = "15px Arial";
  ctx.fillText("Recent event arrivals and time gaps", 25, 28);

  const left = 40;
  const right = width - 35;
  const centerY = 125;
  const visibleDuration = Math.max(5 / lambda, 4);
  const displayStart = Math.max(0, data.simulation_time - visibleDuration);

  ctx.strokeStyle = "#555"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(left, centerY); ctx.lineTo(right, centerY); ctx.stroke();

  const arrivals = data.recent_arrival_times.filter(value => value >= displayStart);
  for (let i = 0; i < arrivals.length; i++) {
    const x = left + ((arrivals[i] - displayStart) / visibleDuration) * (right - left);
    ctx.fillStyle = "#d74638";
    ctx.beginPath(); ctx.arc(x, centerY, 8, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = "#d74638"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, centerY - 30); ctx.lineTo(x, centerY + 30); ctx.stroke();

    if (i > 0) {
      const px = left + ((arrivals[i - 1] - displayStart) / visibleDuration) * (right - left);
      const gap = arrivals[i] - arrivals[i - 1];
      ctx.strokeStyle = "#1769d2"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, centerY - 48); ctx.lineTo(x, centerY - 48); ctx.stroke();
      ctx.fillStyle = "#1769d2"; ctx.font = "12px Arial";
      ctx.fillText(gap.toFixed(2), (px + x) / 2 - 12, centerY - 58);
    }
  }

  ctx.fillStyle = "#333"; ctx.font = "13px Arial";
  ctx.fillText(displayStart.toFixed(2), left - 8, centerY + 50);
  ctx.fillText(data.simulation_time.toFixed(2), right - 18, centerY + 50);

  const latest = data.interarrival_times.length
    ? `Latest interarrival time = ${data.interarrival_times.at(-1).toFixed(3)}`
    : "Waiting for the first event";
  ctx.fillStyle = "#20242a"; ctx.font = "bold 17px Arial";
  ctx.fillText(latest, 145, 220);
}

startButton.addEventListener("click", startSimulation);
pauseButton.addEventListener("click", pauseSimulation);
resetButton.addEventListener("click", resetSimulation);
exportButton.addEventListener("click", exportResultsToExcel);

for (const input of [lambdaInput, intervalInput, maxCountInput, binInput]) {
  input.addEventListener("change", resetSimulation);
}
speedInput.addEventListener("change", () => {
  const values = getParameters();
  if (values) speed = values.speed;
});

(function initialize() {
  if (!window.PoissonEngine) {
    setApiStatus("Engine not loaded", "error");
    setMessage("sim-engine.js could not be loaded. Reload the page.");
    [startButton, pauseButton, resetButton, exportButton].forEach(button => button.disabled = true);
    return;
  }
  setApiStatus(`In browser – v${PoissonEngine.ENGINE_VERSION}`, "ok");
  resetSimulation();
})();
