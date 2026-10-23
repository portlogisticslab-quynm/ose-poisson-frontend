/*
  Poisson / Exponential simulation engine — runs entirely in the browser.
  Replaces the former backend API (/api/sessions, /step, /export.xlsx).
  The snapshot returned by snapshot() keeps the same field names the backend used,
  so the drawing and chart code did not need to change.

  © 2026 Nguyen Minh Quy – portlogistics.vn
*/
(function (root) {
  "use strict";

  const ENGINE_VERSION = "2.0.0-browser";
  const RECENT_LIMIT = 600;          // arrivals kept for the animations
  const EXCEL_ROW_LIMIT = 1048575;   // Excel sheet limit minus the header row

  /* ---------- random numbers ---------- */

  // Uniform on (0, 1]: never 0, so -ln(U) is always finite.
  function cryptoUniform() {
    const buffer = new Uint32Array(256);
    let index = buffer.length;
    return function () {
      if (index >= buffer.length) {
        root.crypto.getRandomValues(buffer);
        index = 0;
      }
      return (buffer[index++] + 1) / 4294967296;
    };
  }

  // Small seeded generator (mulberry32) for reproducible tests.
  function seededUniform(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (((t ^ (t >>> 14)) >>> 0) + 1) / 4294967296;
    };
  }

  /* ---------- distributions ---------- */

  function logFactorial(k) {
    let s = 0;
    for (let i = 2; i <= k; i++) s += Math.log(i);
    return s;
  }

  function poissonPmf(k, mu) {
    return Math.exp(-mu + k * Math.log(mu) - logFactorial(k));
  }

  function exponentialCdf(x, lambda) {
    return x <= 0 ? 0 : 1 - Math.exp(-lambda * x);
  }

  // Running mean/variance (Welford), O(1) per observation.
  class RunningStats {
    constructor() { this.n = 0; this.mean = 0; this.m2 = 0; }
    add(x) {
      this.n++;
      const delta = x - this.mean;
      this.mean += delta / this.n;
      this.m2 += delta * (x - this.mean);
    }
    get variance() { return this.n > 1 ? this.m2 / (this.n - 1) : 0; }
  }

  /* ---------- parameters ---------- */

  function validateParameters(p) {
    const out = {
      lambda_rate: Number(p.lambda_rate),
      interval_length: Number(p.interval_length),
      max_count: Number(p.max_count),
      number_of_bins: Number(p.number_of_bins)
    };
    if (!Number.isFinite(out.lambda_rate) || out.lambda_rate <= 0) throw new Error("λ must be greater than zero.");
    if (!Number.isFinite(out.interval_length) || out.interval_length <= 0) throw new Error("The Poisson interval T must be greater than zero.");
    if (!Number.isInteger(out.max_count) || out.max_count < 4) throw new Error("Maximum Poisson count must be an integer of at least 4.");
    if (!Number.isInteger(out.number_of_bins) || out.number_of_bins < 4) throw new Error("Histogram bins must be an integer of at least 4.");
    return out;
  }

  /* ---------- simulation ---------- */

  class PoissonSimulation {
    constructor(parameters, options = {}) {
      this.parameters = validateParameters(parameters);
      this.uniform = options.seed !== undefined ? seededUniform(options.seed) : cryptoUniform();
      this.createdAt = new Date();
      this.reset();
    }

    reset() {
      this.simulationTime = 0;
      this.intervalIndex = 0;            // current interval = [index·T, (index+1)·T)
      this.currentCount = 0;
      this.intervalCounts = [];
      this.arrivalTimes = [];
      this.interarrivalTimes = [];
      this.lastArrival = 0;
      this.nextArrival = this.sampleExponential();
      // incremental statistics so each animation frame stays O(1)
      this.countStats = new RunningStats();
      this.waitStats = new RunningStats();
      this.countFrequencies = new Array(this.parameters.max_count + 1).fill(0);
      this.maxInterarrival = 0;
      this.histCache = null;            // { upper, counts, n }
    }

    addInterval(count) {
      this.intervalCounts.push(count);
      this.countStats.add(count);
      this.countFrequencies[Math.min(count, this.parameters.max_count)]++;
    }

    addInterarrival(x) {
      this.interarrivalTimes.push(x);
      this.waitStats.add(x);
      if (x > this.maxInterarrival) this.maxInterarrival = x;
    }

    sampleExponential() {
      return -Math.log(this.uniform()) / this.parameters.lambda_rate;
    }

    intervalStart(index = this.intervalIndex) {
      return index * this.parameters.interval_length;
    }

    // Close every interval whose end is ≤ t (arrivals exactly on a boundary go to the next interval).
    closeIntervalsUpTo(t) {
      while (this.intervalStart(this.intervalIndex + 1) <= t) {
        this.addInterval(this.currentCount);
        this.currentCount = 0;
        this.intervalIndex++;
      }
    }

    step(deltaTime) {
      const delta = Number(deltaTime);
      if (!Number.isFinite(delta) || delta <= 0) return this;
      const target = this.simulationTime + delta;

      while (this.nextArrival <= target) {
        const t = this.nextArrival;
        this.closeIntervalsUpTo(t);
        this.currentCount++;
        this.arrivalTimes.push(t);
        this.addInterarrival(t - this.lastArrival);
        this.lastArrival = t;
        this.nextArrival = t + this.sampleExponential();
      }
      this.closeIntervalsUpTo(target);
      this.simulationTime = target;
      return this;
    }

    recentArrivals() {
      const p = this.parameters;
      const windowStart = Math.min(
        this.intervalStart(),
        this.simulationTime - Math.max(5 / p.lambda_rate, 4)
      );
      const out = [];
      for (let i = this.arrivalTimes.length - 1; i >= 0 && out.length < RECENT_LIMIT; i--) {
        if (this.arrivalTimes[i] < windowStart) break;
        out.push(this.arrivalTimes[i]);
      }
      return out.reverse();
    }

    poissonDistribution() {
      const { lambda_rate: lambda, interval_length: T, max_count: maxK } = this.parameters;
      const mu = lambda * T;
      const n = this.intervalCounts.length;
      const frequencies = this.countFrequencies.slice();

      const labels = [], observed = [], theoretical = [];
      let cumulative = 0;
      for (let k = 0; k <= maxK; k++) {
        const isTail = k === maxK;
        labels.push(isTail ? `${maxK}+` : String(k));
        observed.push(n ? frequencies[k] / n : 0);
        const p = isTail ? Math.max(0, 1 - cumulative) : poissonPmf(k, mu);
        cumulative += p;
        theoretical.push(p);
      }
      return { labels, observed, theoretical, frequencies };
    }

    exponentialHistogram() {
      const { lambda_rate: lambda, number_of_bins: bins } = this.parameters;
      const values = this.interarrivalTimes;
      const upper = Math.max(5 / lambda, this.maxInterarrival);
      const width = upper / bins;

      // Bin edges only change when a new maximum appears: rebin everything then,
      // otherwise add just the new observations.
      let cache = this.histCache;
      if (!cache || cache.upper !== upper) cache = this.histCache = { upper, counts: new Array(bins).fill(0), n: 0 };
      const counts = cache.counts;
      for (let i = cache.n; i < values.length; i++) counts[Math.min(bins - 1, Math.floor(values[i] / width))]++;
      cache.n = values.length;

      const n = values.length;
      const labels = [], lower_edges = [], upper_edges = [], observed_densities = [], theoretical_densities = [];
      for (let i = 0; i < bins; i++) {
        const a = i * width, b = (i + 1) * width;
        lower_edges.push(a);
        upper_edges.push(b);
        labels.push(`${a.toFixed(2)}–${b.toFixed(2)}`);
        observed_densities.push(n ? counts[i] / (n * width) : 0);
        // average theoretical density over the bin = P(a ≤ X < b) / width
        theoretical_densities.push((exponentialCdf(b, lambda) - exponentialCdf(a, lambda)) / width);
      }
      return { labels, lower_edges, upper_edges, counts: counts.slice(), observed_densities, theoretical_densities, bin_width: width };
    }

    metrics() {
      const { lambda_rate: lambda, interval_length: T } = this.parameters;
      const counts = this.countStats;
      const waits = this.waitStats;
      return {
        observed_mean_count: counts.mean,
        observed_variance_count: counts.variance,
        theoretical_mean_count: lambda * T,
        theoretical_variance_count: lambda * T,
        observed_mean_waiting: waits.mean,
        observed_variance_waiting: waits.variance,
        theoretical_mean_waiting: 1 / lambda,
        theoretical_variance_waiting: 1 / (lambda * lambda)
      };
    }

    snapshot() {
      return {
        engine_version: ENGINE_VERSION,
        parameters: { ...this.parameters },
        simulation_time: this.simulationTime,
        current_interval_start: this.intervalStart(),
        current_interval_count: this.currentCount,
        interval_counts: this.intervalCounts,
        interarrival_times: this.interarrivalTimes,
        total_events: this.arrivalTimes.length,
        recent_arrival_times: this.recentArrivals(),
        metrics: this.metrics(),
        poisson_distribution: this.poissonDistribution(),
        exponential_histogram: this.exponentialHistogram()
      };
    }

    /* ---------- Excel content (array-of-arrays per sheet) ---------- */

    workbookSheets() {
      const p = this.parameters;
      const m = this.metrics();
      const pd = this.poissonDistribution();
      const eh = this.exponentialHistogram();
      const T = p.interval_length;
      const truncated = [];

      const summary = [
        ["Poisson and Exponential Distribution Simulation"],
        ["Computed in the browser", `engine ${ENGINE_VERSION}`],
        ["Exported at", new Date().toISOString()],
        [],
        ["Parameter", "Value"],
        ["Event rate λ", p.lambda_rate],
        ["Poisson interval T", T],
        ["Maximum Poisson count", p.max_count],
        ["Exponential histogram bins", p.number_of_bins],
        [],
        ["Result", "Observed", "Theoretical"],
        ["Simulation time", this.simulationTime, ""],
        ["Total events", this.arrivalTimes.length, p.lambda_rate * this.simulationTime],
        ["Completed Poisson intervals", this.intervalCounts.length, ""],
        ["Events in current (incomplete) interval", this.currentCount, ""],
        ["Mean events per interval", m.observed_mean_count, m.theoretical_mean_count],
        ["Variance of events per interval", m.observed_variance_count, m.theoretical_variance_count],
        ["Exponential samples", this.interarrivalTimes.length, ""],
        ["Mean interarrival time", m.observed_mean_waiting, m.theoretical_mean_waiting],
        ["Variance of interarrival time", m.observed_variance_waiting, m.theoretical_variance_waiting]
      ];

      const intervals = [["Interval", "Start", "End", "Event count"]];
      const nIntervals = Math.min(this.intervalCounts.length, EXCEL_ROW_LIMIT);
      for (let i = 0; i < nIntervals; i++) intervals.push([i + 1, i * T, (i + 1) * T, this.intervalCounts[i]]);
      if (nIntervals < this.intervalCounts.length) truncated.push("Poisson_Intervals");

      const events = [["Event", "Arrival time", "Interarrival time"]];
      const nEvents = Math.min(this.arrivalTimes.length, EXCEL_ROW_LIMIT);
      for (let i = 0; i < nEvents; i++) events.push([i + 1, this.arrivalTimes[i], this.interarrivalTimes[i]]);
      if (nEvents < this.arrivalTimes.length) truncated.push("Events");

      const pmf = [["k", "Observed frequency", "Observed proportion", "Theoretical probability"]];
      for (let k = 0; k < pd.labels.length; k++) pmf.push([pd.labels[k], pd.frequencies[k], pd.observed[k], pd.theoretical[k]]);

      const hist = [["Bin", "Lower", "Upper", "Observed count", "Observed density", "Theoretical density"]];
      for (let i = 0; i < eh.labels.length; i++) {
        hist.push([i + 1, eh.lower_edges[i], eh.upper_edges[i], eh.counts[i], eh.observed_densities[i], eh.theoretical_densities[i]]);
      }

      if (truncated.length) summary.push([], ["Note", `Sheets truncated at Excel row limit: ${truncated.join(", ")}`]);

      return [
        { name: "Summary", rows: summary, widths: [40, 22, 22] },
        { name: "Poisson_Intervals", rows: intervals, widths: [10, 14, 14, 14] },
        { name: "Events", rows: events, widths: [10, 16, 18] },
        { name: "Poisson_PMF", rows: pmf, widths: [8, 20, 20, 24] },
        { name: "Exponential_Histogram", rows: hist, widths: [8, 12, 12, 16, 18, 20] }
      ];
    }
  }

  const api = { PoissonSimulation, validateParameters, poissonPmf, ENGINE_VERSION };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PoissonEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
