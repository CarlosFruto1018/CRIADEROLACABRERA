// Registro global para los objetos de gráfico de Chart.js
const charts = {};

// Variables globales para almacenar los datos cargados
let companyData = null;
let benchmarkData = null;
let trmData = null;

// Rango seleccionado por defecto para la TRM
let currentTrmRange = '365'; 

// Cargar archivos JSON asíncronamente
async function fetchJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Error al cargar ${path}: ${res.statusText}`);
  return res.json();
}

// Cargar y procesar el CSV de TRM
async function fetchCSV(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Error al cargar ${path}: ${res.statusText}`);
  const txt = await res.text();
  const rows = txt.trim().split(/\r?\n/);
  
  // Omitir cabecera y parsear líneas
  rows.shift();
  const parsedData = rows.map(r => {
    const cols = r.split(',');
    if (cols.length < 2) return null;
    return {
      fecha: new Date(cols[0]),
      trm: parseFloat(cols[1])
    };
  }).filter(d => d !== null && !isNaN(d.trm));

  // Ordenar cronológicamente
  return parsedData.sort((a, b) => a.fecha - b.fecha);
}

// Utilidades de formato
function formatCurrency(val, decimals = 0) {
  if (val === null || val === undefined || isNaN(val)) return '-';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(val);
}

function formatNumber(val, decimals = 0) {
  if (val === null || val === undefined || isNaN(val)) return '-';
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(val);
}

function formatPercent(val, decimals = 1) {
  if (val === null || val === undefined || isNaN(val)) return '-';
  return new Intl.NumberFormat('es-CO', {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(val / 100);
}

// Obtener colores según el tema activo para Chart.js
function getChartColors() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    textColor: isDark ? '#cbd5e1' : '#334155',
    gridColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(226, 232, 240, 0.8)',
    tooltipBg: isDark ? '#1e293b' : '#ffffff',
    tooltipText: isDark ? '#f8fafc' : '#0f172a',
    tooltipBorder: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(15, 23, 42, 0.08)'
  };
}

// Inicializar la aplicación
async function init() {
  try {
    // 1. Cargar todos los recursos de datos en paralelo
    const [company, benchmark, trm] = await Promise.all([
      fetchJSON('../CRIADERO_LA_CABRERA_SAS_900433596.json'),
      fetchJSON('../Benchmark_CRIADERO_LA_CABRERA_SAS_900433596.json'),
      fetchCSV('../TRM_Historico_5Y.csv')
    ]);

    companyData = company;
    benchmarkData = benchmark;
    trmData = trm;

    // Configurar controladores de eventos
    setupEventListeners();
    
    // Configurar tema inicial
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);

    // 2. Renderizado Inicial
    const currentYear = document.getElementById('year-selector').value;
    const currentPeer = document.getElementById('peer-selector').value;
    
    updateKPIs(currentYear);
    updateFinancialTrendChart();
    updateBalanceStructureChart(currentYear);
    updateBenchmarkChart(currentYear, currentPeer);
    updateTRMChart(currentTrmRange);
    updateRankingTable();

  } catch (error) {
    console.error('Error durante la inicialización del Dashboard:', error);
    showErrorAlert(error.message);
  }
}

// Configurar detectores de eventos del DOM
function setupEventListeners() {
  // Cambio de Año
  document.getElementById('year-selector').addEventListener('change', (e) => {
    const year = e.target.value;
    document.getElementById('kpi-year-label').textContent = `Año de análisis: ${year}`;
    document.getElementById('balance-chart-year-label').textContent = `Año ${year}`;
    
    updateKPIs(year);
    updateBalanceStructureChart(year);
    
    const peer = document.getElementById('peer-selector').value;
    updateBenchmarkChart(year, peer);
  });

  // Cambio de Peer Group (Sector)
  document.getElementById('peer-selector').addEventListener('change', (e) => {
    const peer = e.target.value;
    const year = document.getElementById('year-selector').value;
    updateBenchmarkChart(year, peer);
  });

  // Filtros de Rango de TRM
  const trmButtons = document.querySelectorAll('#trm-range-selector button');
  trmButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      trmButtons.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      
      currentTrmRange = e.target.getAttribute('data-range');
      updateTRMChart(currentTrmRange);
    });
  });

  // Conmutador de Tema Claro/Oscuro
  const themeToggleBtn = document.getElementById('theme-toggle');
  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
    
    // Actualizar colores de los gráficos
    applyChartThemeColors();
  });
}

// Alternar el ícono del tema
function updateThemeIcon(theme) {
  const icon = document.querySelector('#theme-toggle i');
  if (theme === 'dark') {
    icon.className = 'fa-solid fa-sun';
  } else {
    icon.className = 'fa-solid fa-moon';
  }
}

// Aplicar estilos a Chart.js en base al tema
function applyChartThemeColors() {
  const c = getChartColors();
  
  // Establecer colores por defecto globales de Chart.js
  Chart.defaults.color = c.textColor;
  
  Object.values(charts).forEach(chart => {
    if (!chart) return;
    
    // Actualizar estilos de las escalas
    if (chart.options.scales) {
      if (chart.options.scales.x) {
        chart.options.scales.x.grid.color = c.gridColor;
        if (chart.options.scales.x.ticks) chart.options.scales.x.ticks.color = c.textColor;
      }
      if (chart.options.scales.y) {
        chart.options.scales.y.grid.color = c.gridColor;
        if (chart.options.scales.y.ticks) chart.options.scales.y.ticks.color = c.textColor;
      }
    }
    
    // Actualizar leyendas
    if (chart.options.plugins && chart.options.plugins.legend) {
      chart.options.plugins.legend.labels.color = c.textColor;
    }
    
    // Actualizar tooltips
    if (chart.options.plugins && chart.options.plugins.tooltip) {
      chart.options.plugins.tooltip.backgroundColor = c.tooltipBg;
      chart.options.plugins.tooltip.titleColor = c.tooltipText;
      chart.options.plugins.tooltip.bodyColor = c.tooltipText;
      chart.options.plugins.tooltip.borderColor = c.tooltipBorder;
    }
    
    chart.update();
  });
}

// Mostrar alerta de error en la interfaz
function showErrorAlert(message) {
  const main = document.querySelector('main');
  const alert = document.createElement('div');
  alert.className = 'company-info-card';
  alert.style.backgroundColor = 'var(--danger-light)';
  alert.style.borderColor = 'var(--danger-color)';
  alert.style.color = 'var(--danger-color)';
  alert.style.padding = '20px';
  alert.style.marginBottom = '20px';
  alert.innerHTML = `
    <h3 style="font-family:'Outfit'; margin-bottom:8px;"><i class="fa-solid fa-triangle-exclamation"></i> Error al cargar datos</h3>
    <p>${message}</p>
    <p style="font-size: 0.8rem; margin-top:8px;">Por favor, verifique que los archivos de datos existan y que el servidor web local esté ejecutándose correctamente.</p>
  `;
  main.prepend(alert);
}

// -------------------------------------------------------------
// 1. ACTUALIZAR KPIs PRINCIPALES (TARJETAS DE MÉTRICAS)
// -------------------------------------------------------------
function updateKPIs(yearStr) {
  const year = parseInt(yearStr);
  const er = companyData.financials.estado_resultados;
  const esf = companyData.financials.estado_situacion_financiera;
  
  // Buscar datos del año seleccionado
  const currentER = er.find(d => d.anio === year);
  const currentESF = esf.find(d => d.anio === year);
  
  // Buscar datos del año anterior para variaciones
  const prevER = er.find(d => d.anio === (year - 1));
  const prevESF = esf.find(d => d.anio === (year - 1));

  // --- KPI 1: Ingresos Operacionales ---
  const ingresosEl = document.getElementById('kpi-ingresos');
  const ingresosFooter = document.getElementById('kpi-ingresos-footer');
  if (currentER) {
    const ingresosMM = currentER.ingresos_operacionales / 1000000;
    ingresosEl.textContent = formatCurrency(ingresosMM, 2) + ' MM';
    
    if (prevER && prevER.ingresos_operacionales > 0) {
      const varPct = ((currentER.ingresos_operacionales - prevER.ingresos_operacionales) / prevER.ingresos_operacionales) * 100;
      const isUp = varPct >= 0;
      ingresosFooter.innerHTML = `
        <span class="trend-badge ${isUp ? 'trend-up' : 'trend-down'}">
          <i class="fa-solid ${isUp ? 'fa-arrow-up' : 'fa-arrow-down'}"></i> ${Math.abs(varPct).toFixed(1)}%
        </span>
        <span class="metric-footer-text">vs año anterior (${year - 1})</span>
      `;
    } else {
      ingresosFooter.innerHTML = `<span class="metric-footer-text">Sin datos históricos previos</span>`;
    }
  } else {
    ingresosEl.textContent = '-';
    ingresosFooter.innerHTML = '';
  }

  // --- KPI 2: Ganancia Neta ---
  const utilidadEl = document.getElementById('kpi-utilidad-neta');
  const utilidadFooter = document.getElementById('kpi-utilidad-neta-footer');
  if (currentER) {
    const utilidadMM = currentER.ganancia_neta / 1000000;
    utilidadEl.textContent = formatCurrency(utilidadMM, 2) + ' MM';
    
    // Variación vs año anterior
    if (prevER) {
      const currentNet = currentER.ganancia_neta;
      const prevNet = prevER.ganancia_neta;
      
      let varPctStr = '';
      let isUp = true;
      
      if (prevNet > 0) {
        const varPct = ((currentNet - prevNet) / prevNet) * 100;
        isUp = varPct >= 0;
        varPctStr = Math.abs(varPct).toFixed(1) + '%';
      } else if (prevNet < 0 && currentNet > prevNet) {
        // Mejora desde pérdida
        isUp = true;
        varPctStr = 'Mejora';
      } else {
        isUp = currentNet >= prevNet;
        varPctStr = 'N/D';
      }
      
      utilidadFooter.innerHTML = `
        <span class="trend-badge ${isUp ? 'trend-up' : 'trend-down'}">
          <i class="fa-solid ${isUp ? 'fa-arrow-up' : 'fa-arrow-down'}"></i> ${varPctStr}
        </span>
        <span class="metric-footer-text">vs año anterior (${year - 1})</span>
      `;
    } else {
      utilidadFooter.innerHTML = `<span class="metric-footer-text">Sin datos históricos previos</span>`;
    }
  } else {
    utilidadEl.textContent = '-';
    utilidadFooter.innerHTML = '';
  }

  // --- KPI 3: Margen Neto ---
  const margenEl = document.getElementById('kpi-margen-neto');
  if (currentER && currentER.ingresos_operacionales > 0) {
    const margenNeto = (currentER.ganancia_neta / currentER.ingresos_operacionales) * 100;
    margenEl.textContent = formatPercent(margenNeto, 1);
  } else {
    margenEl.textContent = '-';
  }

  // --- KPI 4: Razón Corriente ---
  const razonCteEl = document.getElementById('kpi-razon-corriente');
  const razonCteFooter = document.getElementById('kpi-razon-corriente-footer');
  if (currentESF && currentESF.total_pasivos_corrientes > 0) {
    const rc = currentESF.total_activos_corrientes / currentESF.total_pasivos_corrientes;
    razonCteEl.textContent = rc.toFixed(2) + 'x';
    
    // Umbral de salud financiera (RC >= 1.0)
    const isHealthy = rc >= 1.0;
    razonCteFooter.innerHTML = `
      <span class="trend-badge ${isHealthy ? 'trend-up' : 'trend-down'}">
        <i class="fa-solid ${isHealthy ? 'fa-check' : 'fa-triangle-exclamation'}"></i> ${isHealthy ? 'Saludable' : 'Riesgo C/P'}
      </span>
      <span class="metric-footer-text">Activo Cte / Pasivo Cte</span>
    `;
  } else {
    razonCteEl.textContent = '-';
    razonCteFooter.innerHTML = `<span class="metric-footer-text">Sin datos de Balance</span>`;
  }

  // --- KPI 5: Nivel de Endeudamiento ---
  const endel = document.getElementById('kpi-endeudamiento');
  const endelFooter = document.getElementById('kpi-endeudamiento-footer');
  if (currentESF && currentESF.total_activos > 0) {
    const endeudamiento = (currentESF.total_pasivos / currentESF.total_activos) * 100;
    endel.textContent = formatPercent(endeudamiento, 1);
    
    // Umbral típico de apalancamiento sano (< 60%)
    const isSafe = endeudamiento < 60.0;
    endelFooter.innerHTML = `
      <span class="trend-badge ${isSafe ? 'trend-up' : 'trend-neutral'}">
        <i class="fa-solid ${isSafe ? 'fa-shield-halved' : 'fa-circle-info'}"></i> ${isSafe ? 'Moderado' : 'Apalancado'}
      </span>
      <span class="metric-footer-text">Pasivos / Activos</span>
    `;
  } else {
    endel.textContent = '-';
    endelFooter.innerHTML = `<span class="metric-footer-text">Sin datos de Balance</span>`;
  }

  // --- KPI 6: ROA ---
  const roaEl = document.getElementById('kpi-roa');
  if (currentER && currentESF && currentESF.total_activos > 0) {
    const roa = (currentER.ganancia_neta / currentESF.total_activos) * 100;
    roaEl.textContent = formatPercent(roa, 1);
  } else {
    roaEl.textContent = '-';
  }
}

// -------------------------------------------------------------
// 2. GRÁFICO HISTÓRICO DE INGRESOS Y GANANCIAS (COMBINADO)
// -------------------------------------------------------------
function updateFinancialTrendChart() {
  const er = [...companyData.financials.estado_resultados].sort((a, b) => a.anio - b.anio);
  
  const labels = er.map(d => d.anio);
  const ingresosData = er.map(d => d.ingresos_operacionales / 1000000);
  const gananciaOpData = er.map(d => d.ganancia_operacional / 1000000);
  const gananciaNetaData = er.map(d => d.ganancia_neta / 1000000);

  const ctx = document.getElementById('financialTrendChart').getContext('2d');
  const c = getChartColors();
  
  if (charts.trend) {
    charts.trend.destroy();
  }

  charts.trend = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Ingresos Operacionales',
          data: ingresosData,
          backgroundColor: 'rgba(37, 99, 235, 0.75)',
          borderColor: '#2563eb',
          borderWidth: 1.5,
          borderRadius: 6,
          order: 2
        },
        {
          label: 'Ganancia Operacional',
          data: gananciaOpData,
          type: 'line',
          borderColor: '#10b981',
          backgroundColor: '#10b981',
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: false,
          order: 1
        },
        {
          label: 'Ganancia Neta',
          data: gananciaNetaData,
          type: 'line',
          borderColor: '#f59e0b',
          backgroundColor: '#f59e0b',
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: false,
          order: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: c.textColor, font: { family: 'Inter', weight: 500 } }
        },
        tooltip: {
          backgroundColor: c.tooltipBg,
          titleColor: c.tooltipText,
          bodyColor: c.tooltipText,
          borderColor: c.tooltipBorder,
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function(context) {
              return ` ${context.dataset.label}: ${formatCurrency(context.raw, 2)} MM COP`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: c.gridColor },
          ticks: { color: c.textColor, font: { family: 'Inter' } }
        },
        y: {
          grid: { color: c.gridColor },
          ticks: {
            color: c.textColor,
            font: { family: 'Inter' },
            callback: function(value) {
              return formatNumber(value) + ' MM';
            }
          }
        }
      }
    }
  });
}

// -------------------------------------------------------------
// 3. GRÁFICO ESTRUCTURA DEL BALANCE GENERAL (APILADO)
// -------------------------------------------------------------
function updateBalanceStructureChart(yearStr) {
  const year = parseInt(yearStr);
  const esf = companyData.financials.estado_situacion_financiera;
  const currentESF = esf.find(d => d.anio === year);

  const ctx = document.getElementById('balanceStructureChart').getContext('2d');
  const c = getChartColors();
  
  if (charts.balance) {
    charts.balance.destroy();
  }

  if (!currentESF) {
    // Si no hay datos, renderizar canvas vacío con mensaje
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = c.textColor;
    ctx.textAlign = 'center';
    ctx.font = '14px Inter';
    ctx.fillText('No hay datos de balance general para este año.', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  const activoCte = currentESF.total_activos_corrientes / 1000000;
  const activoNoCte = (currentESF.total_activos - currentESF.total_activos_corrientes) / 1000000;
  
  const pasivoCte = currentESF.total_pasivos_corrientes / 1000000;
  const pasivoNoCte = (currentESF.total_pasivos - currentESF.total_pasivos_corrientes) / 1000000;
  const patrimonio = currentESF.patrimonio_total / 1000000;

  charts.balance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Activos', 'Pasivos y Patrimonio'],
      datasets: [
        // Primer nivel (Corriente)
        {
          label: 'Activo Corriente',
          data: [activoCte, 0],
          backgroundColor: 'rgba(59, 130, 246, 0.8)',
          stack: 'stack0'
        },
        {
          label: 'Activo No Corriente',
          data: [activoNoCte, 0],
          backgroundColor: 'rgba(30, 64, 175, 0.85)',
          stack: 'stack0'
        },
        // Segundo nivel (Pasivos & Patrimonio)
        {
          label: 'Pasivo Corriente',
          data: [0, pasivoCte],
          backgroundColor: 'rgba(239, 68, 68, 0.8)',
          stack: 'stack1'
        },
        {
          label: 'Pasivo No Corriente',
          data: [0, pasivoNoCte],
          backgroundColor: 'rgba(185, 28, 28, 0.85)',
          stack: 'stack1'
        },
        {
          label: 'Patrimonio Total',
          data: [0, patrimonio],
          backgroundColor: 'rgba(16, 185, 129, 0.8)',
          stack: 'stack1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: c.textColor, font: { family: 'Inter', size: 10 } }
        },
        tooltip: {
          backgroundColor: c.tooltipBg,
          titleColor: c.tooltipText,
          bodyColor: c.tooltipText,
          borderColor: c.tooltipBorder,
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              const val = context.raw;
              if (val === 0) return null;
              return ` ${context.dataset.label}: ${formatCurrency(val, 2)} MM COP`;
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: c.textColor, font: { family: 'Inter', weight: 600 } }
        },
        y: {
          stacked: true,
          grid: { color: c.gridColor },
          ticks: {
            color: c.textColor,
            font: { family: 'Inter' },
            callback: function(value) {
              return formatNumber(value) + ' MM';
            }
          }
        }
      }
    }
  });
}

// -------------------------------------------------------------
// 4. GRÁFICO HISTÓRICO DE LA TRM (CON FILTRO DE FECHAS)
// -------------------------------------------------------------
function updateTRMChart(rangeDays) {
  if (!trmData || trmData.length === 0) return;

  // Filtrar según el rango
  let filtered = [...trmData];
  const latestDate = trmData[trmData.length - 1].fecha;
  
  if (rangeDays !== 'all') {
    const days = parseInt(rangeDays);
    const cutoffDate = new Date(latestDate);
    cutoffDate.setDate(cutoffDate.getDate() - days);
    filtered = trmData.filter(d => d.fecha >= cutoffDate);
  }

  // Si no hay datos filtrados, volver a cargar todo
  if (filtered.length === 0) filtered = trmData;

  // Calcular métricas estadísticas para este rango
  const trmValues = filtered.map(d => d.trm);
  const latestTrm = trmValues[trmValues.length - 1];
  const maxTrm = Math.max(...trmValues);
  const minTrm = Math.min(...trmValues);
  const avgTrm = trmValues.reduce((sum, v) => sum + v, 0) / trmValues.length;
  
  // Variación Porcentual
  const firstTrm = trmValues[0];
  const varPct = ((latestTrm - firstTrm) / firstTrm) * 100;

  // Actualizar DOM de estadísticas
  document.getElementById('trm-stat-latest').textContent = formatCurrency(latestTrm, 2);
  document.getElementById('trm-stat-max').textContent = formatCurrency(maxTrm, 2);
  document.getElementById('trm-stat-min').textContent = formatCurrency(minTrm, 2);
  
  const isUp = varPct >= 0;
  const changeEl = document.getElementById('trm-stat-change');
  changeEl.textContent = `${isUp ? '+' : ''}${varPct.toFixed(2)}%`;
  changeEl.style.color = isUp ? 'var(--success-color)' : 'var(--danger-color)';

  // Configurar etiquetas y datasets de gráfico
  // Si hay demasiados puntos, muestrear para mejorar rendimiento
  let chartData = filtered;
  if (filtered.length > 500) {
    const step = Math.ceil(filtered.length / 300);
    chartData = filtered.filter((_, idx) => idx % step === 0);
    // Asegurar que incluimos el último punto
    if (chartData[chartData.length - 1] !== filtered[filtered.length - 1]) {
      chartData.push(filtered[filtered.length - 1]);
    }
  }

  const labels = chartData.map(d => d.fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: '2-digit' }));
  const data = chartData.map(d => d.trm);

  const ctx = document.getElementById('trmChart').getContext('2d');
  const c = getChartColors();
  
  // Crear gradiente debajo de la línea
  const gradient = ctx.createLinearGradient(0, 0, 0, 260);
  gradient.addColorStop(0, 'rgba(239, 68, 68, 0.25)');
  gradient.addColorStop(1, 'rgba(239, 68, 68, 0.0)');

  if (charts.trm) {
    charts.trm.destroy();
  }

  charts.trm = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'TRM (COP/USD)',
        data: data,
        borderColor: '#ef4444',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        fill: true,
        backgroundColor: gradient,
        tension: 0.1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: c.tooltipBg,
          titleColor: c.tooltipText,
          bodyColor: c.tooltipText,
          borderColor: c.tooltipBorder,
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(context) {
              return ` TRM: ${formatCurrency(context.raw, 2)} COP`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: c.textColor,
            font: { family: 'Inter', size: 9 },
            maxTicksLimit: 8
          }
        },
        y: {
          grid: { color: c.gridColor },
          ticks: {
            color: c.textColor,
            font: { family: 'Inter' },
            callback: function(value) {
              return formatCurrency(value, 0);
            }
          }
        }
      }
    }
  });
}

// -------------------------------------------------------------
// 5. GRÁFICO COMPARATIVO DE BENCHMARK SECTORIAL
// -------------------------------------------------------------
function updateBenchmarkChart(yearStr, peerGroup) {
  if (!benchmarkData) return;
  const year = parseInt(yearStr);
  
  // Buscar las estadísticas del sector para ese año
  const peerStatsArr = benchmarkData.benchmark.peer_stats[yearStr];
  if (!peerStatsArr) return;

  const selectedStats = peerStatsArr.find(s => s.nivel === peerGroup);
  if (!selectedStats) return;

  // Obtener los datos financieros correspondientes a la empresa para el año
  const financialsArr = benchmarkData.financials;
  const currentFinancials = financialsArr.find(f => f.anio === year);

  // Métricas a graficar
  const metrics = [
    { key: 'margen_operacional', label: 'Margen Op. (%)' },
    { key: 'margen_neto', label: 'Margen Neto (%)' },
    { key: 'roa', label: 'ROA (%)' },
    { key: 'roe', label: 'ROE (%)' },
    { key: 'endeudamiento', label: 'Endeudamiento (%)' }
  ];

  const labels = metrics.map(m => m.label);
  
  // 1. Datos de nuestra empresa (convertidos a %)
  let companyVals = [0, 0, 0, 0, 0];
  if (currentFinancials && currentFinancials.ingresos_operacionales > 0) {
    const marginOp = (currentFinancials.ganancia_operacional / currentFinancials.ingresos_operacionales) * 100;
    const marginNet = (currentFinancials.ganancia_neta / currentFinancials.ingresos_operacionales) * 100;
    const roa = (currentFinancials.ganancia_neta / currentFinancials.total_activos) * 100;
    const roe = (currentFinancials.ganancia_neta / currentFinancials.patrimonio_total) * 100;
    const end = (currentFinancials.total_pasivos / currentFinancials.total_activos) * 100;

    companyVals = [marginOp, marginNet, roa, roe, end];
  }

  // 2. Datos de los percentiles (convertidos a %)
  const p25Vals = metrics.map(m => (selectedStats[`p25_${m.key}`] || 0) * 100);
  const p50Vals = metrics.map(m => (selectedStats[`p50_${m.key}`] || 0) * 100);
  const p75Vals = metrics.map(m => (selectedStats[`p75_${m.key}`] || 0) * 100);

  const ctx = document.getElementById('benchmarkChart').getContext('2d');
  const c = getChartColors();

  if (charts.benchmark) {
    charts.benchmark.destroy();
  }

  // Actualizar subtítulo del gráfico
  const subtitleMap = {
    'clase': `Clase 0142 (${selectedStats.num_empresas} empresas)`,
    'division': `División 01 (${selectedStats.num_empresas} empresas)`,
    'seccion': `Sección A (${selectedStats.num_empresas} empresas)`
  };
  document.getElementById('benchmark-chart-subtitle').textContent = `Año ${year} · vs ${subtitleMap[peerGroup]}`;

  charts.benchmark = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'CRIADERO LA CABRERA SAS',
          data: companyVals,
          backgroundColor: '#3b82f6',
          borderColor: '#2563eb',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: 'Percentil 25 (Bajo)',
          data: p25Vals,
          backgroundColor: 'rgba(239, 68, 68, 0.45)',
          borderColor: 'rgba(239, 68, 68, 0.8)',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: 'Mediana P50 (Medio)',
          data: p50Vals,
          backgroundColor: 'rgba(245, 158, 11, 0.45)',
          borderColor: 'rgba(245, 158, 11, 0.8)',
          borderWidth: 1,
          borderRadius: 4
        },
        {
          label: 'Percentil 75 (Alto)',
          data: p75Vals,
          backgroundColor: 'rgba(16, 185, 129, 0.45)',
          borderColor: 'rgba(16, 185, 129, 0.8)',
          borderWidth: 1,
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: c.textColor, font: { family: 'Inter', size: 9 } }
        },
        tooltip: {
          backgroundColor: c.tooltipBg,
          titleColor: c.tooltipText,
          bodyColor: c.tooltipText,
          borderColor: c.tooltipBorder,
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              return ` ${context.dataset.label}: ${context.raw.toFixed(1)}%`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: c.textColor, font: { family: 'Inter' } }
        },
        y: {
          grid: { color: c.gridColor },
          ticks: {
            color: c.textColor,
            font: { family: 'Inter' },
            callback: function(value) {
              return value.toFixed(0) + '%';
            }
          }
        }
      }
    }
  });
}

// -------------------------------------------------------------
// 6. COMPLETAR TABLA DE RANKING SECTORIAL (CLASE 0142)
// -------------------------------------------------------------
function updateRankingTable() {
  if (!benchmarkData || !benchmarkData.ranking_clase) return;
  
  const list = benchmarkData.ranking_clase;
  const tbody = document.querySelector('#ranking-table tbody');
  tbody.innerHTML = '';

  list.forEach((company, index) => {
    const tr = document.createElement('tr');
    
    // Resaltar la empresa actual
    if (company.nit === '900433596') {
      tr.className = 'highlight-row';
    }

    const rank = index + 1;
    const name = company.razon_social + (company.nit === '900433596' ? ' ◀ (Empresa)' : '');
    const city = company.ciudad;
    
    const ingresosMM = company.ingresos_operacionales / 1000000;
    const activosMM = company.total_activos / 1000000;
    
    // Margen Neto calculado
    const margenNeto = company.ingresos_operacionales > 0
      ? (company.ganancia_neta / company.ingresos_operacionales) * 100
      : 0;

    tr.innerHTML = `
      <td><strong>${rank}</strong></td>
      <td>${name}</td>
      <td>${city}</td>
      <td style="text-align: right;">${formatNumber(ingresosMM, 1)} MM</td>
      <td style="text-align: right;">${formatNumber(activosMM, 1)} MM</td>
      <td style="text-align: right; font-weight:600; color:${margenNeto >= 0 ? 'var(--success-color)' : 'var(--danger-color)'}">
        ${formatPercent(margenNeto, 1)}
      </td>
    `;
    
    tbody.appendChild(tr);
  });
}

// Arrancar la aplicación al cargar el script
init();
