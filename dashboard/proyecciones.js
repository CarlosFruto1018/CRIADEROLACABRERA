const charts = {};

const forecastYears = 5;

let companyData = null;
let baseDefaults = null;

const moneyFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});

const compactFormatter = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 1,
});

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function formatMillions(value) {
  return `${compactFormatter.format(value / 1_000_000)} MM COP`;
}

function formatPercent(value, decimals = 1) {
  return `${safeNumber(value).toFixed(decimals)}%`;
}

function mean(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (!filtered.length) return 0;
  return filtered.reduce((total, value) => total + value, 0) / filtered.length;
}

function cagr(startValue, endValue, periods) {
  if (startValue <= 0 || endValue <= 0 || periods <= 0) return 0;
  return Math.pow(endValue / startValue, 1 / periods) - 1;
}

async function fetchJSON(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`No fue posible cargar ${path}: ${response.statusText}`);
  }
  return response.json();
}

function getSortedSeries(series) {
  return [...series].sort((left, right) => left.anio - right.anio);
}

function getCurrentYearData(company) {
  const revenueSeries = getSortedSeries(company.financials.estado_resultados);
  const balanceSeries = getSortedSeries(company.financials.estado_situacion_financiera);
  const cashFlowSeries = getSortedSeries(company.financials.estado_flujo_efectivo || []);
  const indicatorSeries = getSortedSeries(company.indicators || []);

  const latestRevenue = revenueSeries[revenueSeries.length - 1];
  const latestBalance = balanceSeries.find((entry) => entry.anio === latestRevenue.anio) || balanceSeries[balanceSeries.length - 1];
  const latestCashFlow = cashFlowSeries.find((entry) => entry.anio === latestRevenue.anio) || cashFlowSeries[cashFlowSeries.length - 1] || {};
  const latestIndicators = indicatorSeries.find((entry) => entry.anio === latestRevenue.anio) || indicatorSeries[indicatorSeries.length - 1] || {};

  return {
    revenueSeries,
    balanceSeries,
    cashFlowSeries,
    indicatorSeries,
    latestRevenue,
    latestBalance,
    latestCashFlow,
    latestIndicators,
  };
}

function buildBaseDefaults(data) {
  const revenueSeries = data.revenueSeries;
  const cashFlowSeries = data.cashFlowSeries;
  const latestRevenue = data.latestRevenue;
  const latestBalance = data.latestBalance;
  const latestIndicators = data.latestIndicators;

  const revenueStart = revenueSeries[0].ingresos_operacionales;
  const revenueEnd = latestRevenue.ingresos_operacionales;
  const fiveYearGrowth = cagr(revenueStart, revenueEnd, revenueSeries.length - 1);

  const recentMargins = revenueSeries.slice(-2).map((entry) => {
    if (!entry.ingresos_operacionales) return 0;
    return (entry.ganancia_operacional / entry.ingresos_operacionales) * 100;
  });

  const recentTaxRate = latestRevenue.ganancia_antes_impuestos > 0
    ? (latestRevenue.gasto_impuesto_renta / latestRevenue.ganancia_antes_impuestos) * 100
    : 25;

  const recentDaRates = cashFlowSeries
    .filter((entry) => entry.ajustes_depreciacion_amortizacion && entry.anio >= latestRevenue.anio - 1)
    .map((entry) => {
      const revenueEntry = revenueSeries.find((row) => row.anio === entry.anio);
      const revenue = revenueEntry ? revenueEntry.ingresos_operacionales : 0;
      return revenue > 0 ? (entry.ajustes_depreciacion_amortizacion / revenue) * 100 : null;
    })
    .filter((value) => Number.isFinite(value) && value > 0);

  const recentCapexRates = cashFlowSeries
    .filter((entry) => entry.compras_propiedad_planta_equipo && entry.anio >= latestRevenue.anio - 1)
    .map((entry) => {
      const revenueEntry = revenueSeries.find((row) => row.anio === entry.anio);
      const revenue = revenueEntry ? revenueEntry.ingresos_operacionales : 0;
      return revenue > 0 ? (entry.compras_propiedad_planta_equipo / revenue) * 100 : null;
    })
    .filter((value) => Number.isFinite(value) && value > 0);

  const forecastGrowth = clamp((fiveYearGrowth * 0.35) + (4 * 0.65), 4, 15);
  const marginTarget = clamp(mean(recentMargins) || latestIndicators.margen_operacional || 10, 6, 20);

  const explicitDebt = safeNumber(latestBalance.otros_pasivos_financieros_corrientes) + safeNumber(latestBalance.otros_pasivos_financieros_no_corrientes);
  const cashBalance = safeNumber(latestBalance.efectivo_equivalentes);
  const currentRevenue = latestRevenue.ingresos_operacionales;

  const debtWeight = explicitDebt > 0 ? clamp((explicitDebt / (explicitDebt + safeNumber(latestBalance.patrimonio_total))) * 100, 0, 60) : 0;

  return {
    revenueSeries,
    cashFlowSeries,
    revenueGrowth: forecastGrowth,
    ebitMargin: marginTarget,
    taxRate: clamp(recentTaxRate, 15, 35),
    daPct: clamp(mean(recentDaRates) || 1.7, 0.5, 5),
    capexPct: clamp(mean(recentCapexRates) || 3.5, 1, 8),
    nwcPct: 5,
    riskFreeRate: 4.5,
    beta: 2.0,
    marketRiskPremium: 6.0,
    countryRiskPremium: 6.0,
    debtWeight,
    costOfDebt: 12.0,
    terminalGrowth: 4.0,
    currentRevenue,
    latestRevenue,
    latestBalance,
    explicitDebt,
    cashBalance,
    fiveYearGrowth: fiveYearGrowth * 100,
  };
}

function getInputValue(id) {
  return Number(document.getElementById(id).value);
}

function setInputValue(id, value) {
  document.getElementById(id).value = Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

function populateInputs(defaults) {
  setInputValue('revenue-growth', defaults.revenueGrowth);
  setInputValue('ebit-margin', defaults.ebitMargin);
  setInputValue('tax-rate', defaults.taxRate);
  setInputValue('da-pct', defaults.daPct);
  setInputValue('capex-pct', defaults.capexPct);
  setInputValue('nwc-pct', defaults.nwcPct);
  setInputValue('risk-free-rate', defaults.riskFreeRate);
  setInputValue('beta', defaults.beta);
  setInputValue('market-risk-premium', defaults.marketRiskPremium);
  setInputValue('country-risk-premium', defaults.countryRiskPremium);
  setInputValue('debt-weight', defaults.debtWeight);
  setInputValue('cost-of-debt', defaults.costOfDebt);
  setInputValue('terminal-growth', defaults.terminalGrowth);
}

function readInputs() {
  return {
    revenueGrowth: getInputValue('revenue-growth') / 100,
    ebitMargin: getInputValue('ebit-margin') / 100,
    taxRate: getInputValue('tax-rate') / 100,
    daPct: getInputValue('da-pct') / 100,
    capexPct: getInputValue('capex-pct') / 100,
    nwcPct: getInputValue('nwc-pct') / 100,
    riskFreeRate: getInputValue('risk-free-rate') / 100,
    beta: getInputValue('beta'),
    marketRiskPremium: getInputValue('market-risk-premium') / 100,
    countryRiskPremium: getInputValue('country-risk-premium') / 100,
    debtWeight: getInputValue('debt-weight') / 100,
    costOfDebt: getInputValue('cost-of-debt') / 100,
    terminalGrowth: getInputValue('terminal-growth') / 100,
  };
}

function computeWacc(inputs) {
  const costEquity = inputs.riskFreeRate + (inputs.beta * inputs.marketRiskPremium) + inputs.countryRiskPremium;
  const debtWeight = clamp(inputs.debtWeight, 0, 0.95);
  const equityWeight = 1 - debtWeight;
  const afterTaxDebt = inputs.costOfDebt * (1 - inputs.taxRate);
  const wacc = (costEquity * equityWeight) + (afterTaxDebt * debtWeight);

  return {
    costEquity,
    afterTaxDebt,
    wacc,
    debtWeight,
    equityWeight,
  };
}

function projectCashFlows(baseData, inputs, waccData) {
  const latestRevenue = baseData.latestRevenue;
  const revenueBase = latestRevenue.ingresos_operacionales;
  const ebitBaseMargin = revenueBase > 0 ? latestRevenue.ganancia_operacional / revenueBase : 0;
  const terminalGrowth = inputs.terminalGrowth;
  const marginTarget = inputs.ebitMargin;

  const projections = [];
  let previousRevenue = revenueBase;
  let previousNwc = revenueBase * inputs.nwcPct;

  for (let yearIndex = 1; yearIndex <= forecastYears; yearIndex += 1) {
    const fade = (yearIndex - 1) / (forecastYears - 1);
    const growth = inputs.revenueGrowth + ((terminalGrowth - inputs.revenueGrowth) * fade);
    const revenue = previousRevenue * (1 + growth);
    const margin = ebitBaseMargin + ((marginTarget - ebitBaseMargin) * fade);
    const ebit = revenue * margin;
    const nopat = ebit * (1 - inputs.taxRate);
    const da = revenue * inputs.daPct;
    const capex = revenue * inputs.capexPct;
    const nwc = revenue * inputs.nwcPct;
    const deltaNwc = nwc - previousNwc;
    const fcff = nopat + da - capex - deltaNwc;
    const discountFactor = 1 / Math.pow(1 + waccData.wacc, yearIndex);
    const pvFcff = fcff * discountFactor;

    projections.push({
      year: latestRevenue.anio + yearIndex,
      growth,
      revenue,
      margin,
      ebit,
      nopat,
      da,
      capex,
      deltaNwc,
      fcff,
      discountFactor,
      pvFcff,
    });

    previousRevenue = revenue;
    previousNwc = nwc;
  }

  const terminalProjection = projections[projections.length - 1];
  const terminalFcff = terminalProjection.fcff * (1 + terminalGrowth);
  const terminalValue = waccData.wacc > terminalGrowth
    ? terminalFcff / (waccData.wacc - terminalGrowth)
    : null;
  const pvTerminal = terminalValue !== null ? terminalValue * terminalProjection.discountFactor : null;

  const pvFcffTotal = projections.reduce((total, projection) => total + projection.pvFcff, 0);
  const enterpriseValue = pvTerminal === null ? null : pvFcffTotal + pvTerminal;

  return {
    projections,
    terminalFcff,
    terminalValue,
    pvTerminal,
    pvFcffTotal,
    enterpriseValue,
  };
}

function renderKpis(baseData, inputs, waccData, valuation) {
  const cashBalance = safeNumber(baseData.cashBalance);
  const debtBalance = safeNumber(baseData.explicitDebt);
  const netDebt = debtBalance - cashBalance;

  document.getElementById('cost-equity').textContent = formatPercent(waccData.costEquity * 100, 1);
  document.getElementById('after-tax-debt').textContent = formatPercent(waccData.afterTaxDebt * 100, 1);
  document.getElementById('financial-debt').textContent = formatMillions(debtBalance);
  document.getElementById('cash-balance').textContent = formatMillions(cashBalance);
  document.getElementById('enterprise-value').textContent = valuation.enterpriseValue === null ? 'No calculable' : formatMillions(valuation.enterpriseValue);
  document.getElementById('wacc-value').textContent = formatPercent(waccData.wacc * 100, 1);
  document.getElementById('pv-fcff-value').textContent = formatMillions(valuation.pvFcffTotal);
  document.getElementById('pv-terminal-value').textContent = valuation.pvTerminal === null ? 'Sin valor terminal' : formatMillions(valuation.pvTerminal);

  const modelSummary = document.getElementById('model-summary');
  const debtShare = waccData.debtWeight * 100;
  modelSummary.textContent = `Se proyectan 5 años de FCFF con crecimiento inicial de ${formatPercent(inputs.revenueGrowth * 100, 1)}, margen EBIT objetivo de ${formatPercent(inputs.ebitMargin * 100, 1)} y crecimiento terminal de ${formatPercent(inputs.terminalGrowth * 100, 1)}. La estructura objetivo usa ${formatPercent(debtShare, 1)} de deuda y ${formatPercent(waccData.equityWeight * 100, 1)} de patrimonio. Net debt observado: ${formatMillions(netDebt)}.`;
}

function buildProjectionTable(valuation, inputs) {
  const tbody = document.querySelector('#projection-table tbody');
  tbody.innerHTML = '';

  valuation.projections.forEach((projection) => {
    const row = document.createElement('tr');
    const cells = [
      projection.year,
      formatMillions(projection.revenue),
      formatMillions(projection.ebit),
      formatMillions(projection.nopat),
      formatMillions(projection.da),
      formatMillions(projection.capex),
      formatMillions(projection.deltaNwc),
      formatMillions(projection.fcff),
      projection.discountFactor.toFixed(4),
      formatMillions(projection.pvFcff),
    ];

    cells.forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });

    tbody.appendChild(row);
  });

  if (valuation.pvTerminal !== null) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>Valor terminal</td>
      <td colspan="7">FCFF año 6 = ${formatMillions(valuation.terminalFcff)} | crecimiento terminal = ${formatPercent(inputs.terminalGrowth * 100, 1)}</td>
      <td>${valuation.projections[valuation.projections.length - 1].discountFactor.toFixed(4)}</td>
      <td>${formatMillions(valuation.pvTerminal)}</td>
    `;
    tbody.appendChild(row);
  }
}

function buildProjectionChart(baseData, valuation) {
  const context = document.getElementById('projection-chart').getContext('2d');
  if (charts.projectionChart) {
    charts.projectionChart.destroy();
  }

  const historicalYears = baseData.revenueSeries.map((entry) => entry.anio);
  const historicalRevenue = baseData.revenueSeries.map((entry) => entry.ingresos_operacionales / 1_000_000);
  const historicalEbit = baseData.revenueSeries.map((entry) => entry.ganancia_operacional / 1_000_000);
  const projectionYears = valuation.projections.map((entry) => entry.year);
  const projectionRevenue = valuation.projections.map((entry) => entry.revenue / 1_000_000);
  const projectionEbit = valuation.projections.map((entry) => entry.ebit / 1_000_000);
  const projectionFcff = valuation.projections.map((entry) => entry.fcff / 1_000_000);

  charts.projectionChart = new Chart(context, {
    type: 'line',
    data: {
      labels: [...historicalYears, ...projectionYears],
      datasets: [
        {
          type: 'line',
          label: 'Ingresos históricos',
          data: historicalRevenue,
          borderColor: '#1d4ed8',
          backgroundColor: 'rgba(29, 78, 216, 0.12)',
          tension: 0.35,
          pointRadius: 3,
        },
        {
          type: 'line',
          label: 'Ingresos proyectados',
          data: new Array(historicalYears.length).fill(null).concat(projectionRevenue),
          borderColor: '#0f766e',
          borderDash: [8, 6],
          tension: 0.35,
          pointRadius: 3,
        },
        {
          type: 'line',
          label: 'EBIT histórico',
          data: historicalEbit,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          tension: 0.3,
          pointRadius: 3,
        },
        {
          type: 'line',
          label: 'EBIT proyectado',
          data: new Array(historicalYears.length).fill(null).concat(projectionEbit),
          borderColor: '#b45309',
          borderDash: [8, 6],
          tension: 0.3,
          pointRadius: 3,
        },
        {
          type: 'bar',
          label: 'FCFF proyectado',
          data: new Array(historicalYears.length).fill(null).concat(projectionFcff),
          backgroundColor: 'rgba(15, 118, 110, 0.35)',
          borderColor: '#0f766e',
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: {
          ticks: {
            callback(value) {
              return `${value} MM`;
            },
          },
        },
      },
      plugins: {
        legend: {
          labels: {
            usePointStyle: true,
          },
        },
        tooltip: {
          callbacks: {
            label(context) {
              const value = context.raw;
              if (value === null || value === undefined) return '';
              return `${context.dataset.label}: ${compactFormatter.format(value)} MM COP`;
            },
          },
        },
      },
    },
  });
}

function buildValuationChart(valuation) {
  const context = document.getElementById('valuation-chart').getContext('2d');
  if (charts.valuationChart) {
    charts.valuationChart.destroy();
  }

  const labels = valuation.projections.map((entry) => entry.year);
  const pvSeries = valuation.projections.map((entry) => entry.pvFcff / 1_000_000);
  const terminalSeries = labels.map((_, index) => (index === labels.length - 1 ? (valuation.pvTerminal || 0) / 1_000_000 : 0));

  charts.valuationChart = new Chart(context, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'PV FCFF por año',
          data: pvSeries,
          backgroundColor: 'rgba(18, 59, 138, 0.42)',
          borderColor: '#123b8a',
          borderWidth: 1,
        },
        {
          label: 'PV valor terminal',
          data: terminalSeries,
          backgroundColor: 'rgba(194, 65, 12, 0.55)',
          borderColor: '#c2410c',
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${compactFormatter.format(context.raw)} MM COP`;
            },
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback(value) {
              return `${value} MM`;
            },
          },
        },
      },
    },
  });
}

function refreshView() {
  const inputs = readInputs();
  const waccData = computeWacc(inputs);
  const valuation = projectCashFlows(baseDefaults, inputs, waccData);

  renderKpis(baseDefaults, inputs, waccData, valuation);
  buildProjectionTable(valuation, inputs);
  buildProjectionChart(baseDefaults, valuation);
  buildValuationChart(valuation);
}

function wireEvents() {
  const inputIds = [
    'revenue-growth',
    'ebit-margin',
    'tax-rate',
    'da-pct',
    'capex-pct',
    'nwc-pct',
    'risk-free-rate',
    'beta',
    'market-risk-premium',
    'country-risk-premium',
    'debt-weight',
    'cost-of-debt',
    'terminal-growth',
  ];

  inputIds.forEach((id) => {
    document.getElementById(id).addEventListener('input', refreshView);
  });

  document.getElementById('reset-button').addEventListener('click', () => {
    populateInputs(baseDefaults);
    refreshView();
  });
}

async function init() {
  const modelSummary = document.getElementById('model-summary');
  try {
    const company = await fetchJSON('../CRIADERO_LA_CABRERA_SAS_900433596.json');
    companyData = company;
    const currentData = getCurrentYearData(companyData);
    baseDefaults = buildBaseDefaults(currentData);

    document.title = `Proyecciones y Valoración — ${company.company.razon_social}`;
    modelSummary.textContent = `Base histórica cargada para ${company.company.razon_social}. El modelo proyecta 5 años de FCFF, estima WACC por CAPM y descuenta el valor terminal con crecimiento de largo plazo del 4%.`;

    populateInputs(baseDefaults);
    wireEvents();
    refreshView();
  } catch (error) {
    console.error(error);
    modelSummary.textContent = `No fue posible cargar los datos: ${error.message}`;
  }
}

init();
