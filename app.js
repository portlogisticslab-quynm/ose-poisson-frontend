"use strict";

const API_BASE = String(window.OSE_API_BASE || "").replace(/\/$/, "");
const STEP_REAL_MS = 180;
const BASE_SIMULATED_DELTA = 0.09;

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

let sessionId = null;
let snapshot = null;
let timerId = null;
let requestInFlight = false;

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

  const speed = Number(speedInput.value);

  if (!Number.isFinite(parameters.lambda_rate) || parameters.lambda_rate <= 0) {
    setMessage("λ must be greater than zero.");
    return null;
  }
  if (!Number.isFinite(parameters.interval_length) || parameters.interval_length <= 0) {
    setMessage("The Poisson interval T must be greater than zero.");
    return null;
  }
  if (!Number.isInteger(parameters.max_count) || parameters.max_count < 4) {
    setMessage("Maximum Poisson count must be an integer of at least 4.");
    return null;
  }
  if (!Number.isInteger(parameters.number_of_bins) || parameters.number_of_bins < 4) {
    setMessage("Histogram bins must be an integer of at least 4.");
    return null;
  }
  if (!Number.isFinite(speed) || speed <= 0) {
    setMessage("Animation speed must be greater than zero.");
    return null;
  }

  setMessage("");
  return { parameters, speed };
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch (_) {}
    throw new Error(detail);
  }

  return response;
}

async function checkHealth() {
  try {
    const response = await apiFetch("/api/health", { method: "GET" });
    const data = await response.json();
    setApiStatus(`Online – ${data.version}`, "ok");
  } catch (error) {
    setApiStatus("Offline", "error");
    setMessage(`Cannot connect to backend: ${error.message}`);
  }
}

async function createSession() {
  const values = getParameters();
  if (!values) return false;

  const response = await apiFetch("/api/sessions", {
    method: "POST",
    body: JSON.stringify(values.parameters)
  });

  snapshot = await response.json();
  sessionId = snapshot.session_id;
  renderSnapshot(snapshot);
  return true;
}

async function resetSimulation() {
  pauseSimulation();
  requestInFlight = false;

  try {
    if (sessionId) {
      await apiFetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
    }
    sessionId = null;
    snapshot = null;
    await createSession();
    setMessage("Simulation reset.", true);
  } catch (error) {
    setMessage(`Reset failed: ${error.message}`);
  }
}

async function simulationStep() {
  if (requestInFlight || !sessionId) return;

  const values = getParameters();
  if (!values) {
    pauseSimulation();
    return;
  }

  requestInFlight = true;
  try {
    const response = await apiFetch(`/api/sessions/${sessionId}/step`, {
      method: "POST",
      body: JSON.stringify({ delta_time: BASE_SIMULATED_DELTA * values.speed })
    });
    snapshot = await response.json();
    renderSnapshot(snapshot);
  } catch (error) {
    pauseSimulation();
    setMessage(`Simulation failed: ${error.message}`);
  } finally {
    requestInFlight = false;
  }
}

async function startSimulation() {
  if (!sessionId) {
    try {
      const created = await createSession();
      if (!created) return;
    } catch (error) {
      setMessage(`Start failed: ${error.message}`);
      return;
    }
  }

  if (timerId !== null) return;
  setMessage("Simulation running…", true);
  timerId = window.setInterval(simulationStep, STEP_REAL_MS);
}

function pauseSimulation() {
  if (timerId !== null) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

async function exportResultsToExcel() {
  if (!sessionId) {
    setMessage("Start or reset the simulation first.");
    return;
  }

  pauseSimulation();
  try {
    const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/export.xlsx`);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const fileName = match ? match[1] : "Poisson_Exponential_Results.xlsx";

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage(`Results exported: ${fileName}`, true);
  } catch (error) {
    setMessage(`Excel export failed: ${error.message}`);
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

[startButton, pauseButton, resetButton, exportButton].forEach(button => button.disabled = true);

startButton.addEventListener("click", startSimulation);
pauseButton.addEventListener("click", pauseSimulation);
resetButton.addEventListener("click", resetSimulation);
exportButton.addEventListener("click", exportResultsToExcel);

for (const input of [lambdaInput, intervalInput, maxCountInput, binInput]) {
  input.addEventListener("change", resetSimulation);
}
speedInput.addEventListener("change", getParameters);

(async function initialize() {
  await checkHealth();
  if (apiStatus.classList.contains("ok")) {
    [startButton, pauseButton, resetButton, exportButton].forEach(button => button.disabled = false);
    await resetSimulation();
  }
})();
