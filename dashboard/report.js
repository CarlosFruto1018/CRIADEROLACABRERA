// report.js — genera un informe Markdown y empaqueta imágenes en un ZIP para descarga
(function(){
  async function loadScript(src){
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
  }

  async function fetchJson(path){
    const r = await fetch(path); if (!r.ok) throw new Error('fetch failed '+path); return r.json();
  }

  function toBase64DataUrl(canvas){
    return canvas.toDataURL('image/png');
  }

  function csvToRows(text){ return text.trim().split(/\r?\n/).map(r=>r.split(/,|;/)); }

  function yearFromDateStr(s){ try{ return new Date(s).getFullYear(); } catch(e){ return null; } }

  async function generate(){
    const zip = new JSZip();
    const outputsFolder = zip.folder('outputs');

    const company = await fetchJson('../CRIADERO_LA_CABRERA_SAS_900433596.json');
    const benchmark = await fetchJson('../Benchmark_CRIADERO_LA_CABRERA_SAS_900433596.json');
    const trmText = await (await fetch('../TRM_Historico_5Y.csv')).text();

    // Prepare basic tables
    const fin = company.financials;
    const results = fin.estado_resultados.slice().sort((a,b)=>a.anio-b.anio);
    const balance = fin.estado_situacion_financiera.slice().sort((a,b)=>a.anio-b.anio);
    const cashflows = fin.estado_flujo_efectivo.slice().sort((a,b)=>a.anio-b.anio);

    const years = results.map(r=>r.anio);
    const revenues = results.map(r=>r.ingresos_operacionales);
    const netIncome = results.map(r=>r.ganancia_neta);

    // TRM yearly averages
    const rows = csvToRows(trmText);
    const header = rows.shift();
    const dateIdx = header.findIndex(h=>/fecha|date/i.test(h))||0;
    const valueIdx = header.findIndex(h=>/trm|valor|value|close/i.test(h))||1;
    const trmByYear = {};
    rows.forEach(r=>{
      const y = yearFromDateStr(r[dateIdx]); const v = parseFloat(r[valueIdx]);
      if (!y || isNaN(v)) return; if (!trmByYear[y]) trmByYear[y]=[]; trmByYear[y].push(v);
    });
    const trmYearAvg = Object.keys(trmByYear).sort().map(y=>({anio:+y, avg: trmByYear[y].reduce((a,b)=>a+b,0)/trmByYear[y].length}));

    // Simple projection (5 años) using last year as base and conservative defaults
    const last = results[results.length-1];
    const baseRevenue = last.ingresos_operacionales;
    const defaultGrowth = 0.05;
    const ebitMargin = (last.ganancia_operacional||0)/ (last.ingresos_operacionales||1);
    const taxRate = 0.3;
    const daPct = 0.05;
    const capexPct = 0.05;
    const nwcPct = 0.05;
    const beta = 2.0, rf=4.5, marketPrem=6, countryPrem=6; // percent
    const Ke = rf + beta*marketPrem + countryPrem; // percent
    const debtWeight = 0.1; const equityWeight = 1-debtWeight; const kd=12; const t=0.3;
    const WACC = Ke*equityWeight + kd*(1-t)*debtWeight;

    const projYears = []; let rev = baseRevenue;
    for(let i=1;i<=5;i++){ rev = rev*(1+defaultGrowth); const ebit = rev * ebitMargin; const nopat = ebit*(1-taxRate); const da = rev*daPct; const capex=rev*capexPct; const dnwc=rev*nwcPct; const fcff = nopat + da - capex - dnwc; projYears.push({anio: last.anio + i, rev, ebit, nopat, da, capex, dnwc, fcff}); }
    const terminalFcff = projYears[projYears.length-1].fcff*(1+0.04);
    const tv = terminalFcff / (WACC/100 - 4/100);

    // Build markdown
    let md = '';
    md += `# Informe Ejecutivo — ${company.company.razon_social}\n\n`;
    md += `## Resumen Ejecutivo\n\n`;
    md += `- Periodo analizado: ${years[0]} - ${years[years.length-1]}\n`;
    md += `- Últimos ingresos (${last.anio}): ${last.ingresos_operacionales.toLocaleString()} ${fin.currency}\n`;
      // If user provided a custom resumen, prefer it
      let md = '';
      try {
        const r = await fetch('./custom_resumen.md');
        if (r.ok) md = await r.text();
      } catch (e) {
        // ignore, proceed to auto-generate
      }

      // Build markdown if not provided
      if (!md) {

    md += `## Descripción de la empresa\n\n`;
    md += `- Razón social: ${company.company.razon_social}\n`;
    md += `- NIT: ${company.company.nit}\n`;
    md += `- Objeto social: ${company.company.objeto_social}\n`;
    md += `- Ubicación: ${company.company.ubicacion.ciudad}, ${company.company.ubicacion.departamento}\n\n`;

    md += `## Análisis de Indicadores Financieros\n\n`;
    md += `|Año|Ingresos|Ganancia Neta|Margen Neto (%)|\n|--:|--:|--:|--:|\n`;
    results.forEach(r=>{
      const margen = (r.ganancia_neta / (r.ingresos_operacionales||1))*100;
      md += `|${r.anio}|${r.ingresos_operacionales.toLocaleString()}|${r.ganancia_neta.toLocaleString()}|${margen.toFixed(1)}|\n`;
    }); md += '\n';

    md += `## Benchmark Sectorial\n\n`;
    md += `Se incluyen estadísticas relevantes (mediana y percentiles) extraídas del benchmark sectorial.\n\n`;
    // include a small table for 2024 medians if present
    const b2024 = benchmark.benchmark?.years?.includes(2024) ? benchmark.peer_stats?.["2024"]?.[0] : null;
    if (b2024){ md += `|Indicador|Mediana Clase 0142 (2024)|\n|--|--:|\n|Ingresos (p50)|${Math.round(b2024.p50_ingresos).toLocaleString()}|\n|Margen neto (p50)|${(b2024.p50_margen_neto*100).toFixed(1)}%|\n\n`; }

    md += `## Análisis TRM y correlación\n\n`;
    md += `Promedio anual TRM:\n\n`;
    md += `|Año|TRM promedio|\n|--:|--:|\n`;
    trmYearAvg.forEach(t=> md += `|${t.anio}|${t.avg.toFixed(2)}|\n`);
    md += `\n`;

    // Correlate yearly revenues and trm averages where years overlap
    const common = trmYearAvg.filter(t=> years.includes(t.anio)).map(t=>({anio:t.anio,trm:t.avg,rev: results.find(r=>r.anio===t.anio).ingresos_operacionales}));
    function pearson(a,b){ const n=a.length; const ma=a.reduce((s,x)=>s+x,0)/n; const mb=b.reduce((s,x)=>s+x,0)/n; let num=0, da=0, db=0; for(let i=0;i<n;i++){ num+=(a[i]-ma)*(b[i]-mb); da+=(a[i]-ma)**2; db+=(b[i]-mb)**2; } return num/Math.sqrt(da*db); }
    let corr = 'N/A'; if (common.length>=2){ corr = pearson(common.map(x=>x.trm), common.map(x=>x.rev)).toFixed(3); }
    md += `Correlación (TRM promedio anual vs Ingresos): **${corr}**\n\n`;

    md += `## Supuestos de proyección\n\n`;
    md += `- Crecimiento anual de ingresos (base): ${(defaultGrowth*100).toFixed(1)}%\n`;
    md += `- Margen EBIT base: ${(ebitMargin*100).toFixed(1)}%\n`;
    md += `- Tasa de impuesto considerada: ${(taxRate*100).toFixed(1)}%\n`;
    md += `- D&A: ${(daPct*100).toFixed(1)}% de ingresos; CAPEX: ${(capexPct*100).toFixed(1)}% de ingresos; ΔNWC: ${(nwcPct*100).toFixed(1)}% de ingresos\n\n`;

    md += `## WACC (estimado)\n\n`;
    md += `- Tasa libre de riesgo: ${rf}%\n- Beta: ${beta}\n- Prima de mercado: ${marketPrem}%\n- Prima país: ${countryPrem}%\n- Coste de capital propio (Ke): ${Ke.toFixed(2)}%\n- Coste de deuda (Kd): ${kd}% (pre impuestos)\n- Estructura: D/V=${debtWeight.toFixed(2)}, E/V=${equityWeight.toFixed(2)}\n- WACC estimado: ${WACC.toFixed(2)}%\n\n`;

    md += `## Valoración por FCL (5 años)\n\n`;
    md += `|Año|Ingresos|FCFF|Factor (WACC ${WACC.toFixed(2)}%)|PV FCFF|\n|--:|--:|--:|--:|--:|\n`;
    const discountRate = 1 + WACC/100; let pvSum=0; for(let i=0;i<projYears.length;i++){ const p=projYears[i]; const factor = 1/Math.pow(discountRate, i+1); const pv = p.fcff*factor; pvSum += pv; md += `|${p.anio}|${Math.round(p.rev).toLocaleString()}|${Math.round(p.fcff).toLocaleString()}|${factor.toFixed(4)}|${Math.round(pv).toLocaleString()}|\n`; }
    const pvTerminal = tv / Math.pow(discountRate, projYears.length);
    md += `|Terminal| - |${Math.round(tv).toLocaleString()}| - |${Math.round(pvTerminal).toLocaleString()}|\n\n`;
    const enterprise = Math.round(pvSum + pvTerminal);
    md += `**Valor presente de las operaciones (Enterprise Value): ${enterprise.toLocaleString()} ${fin.currency}**\n\n`;

    md += `## Sensibilidad (WACC ±1% / g ±1%)\n\n`;
    md += `|WACC|g|Enterprise Value|\n|--:|--:|--:|\n`;
    for(let dw=-1; dw<=1; dw++){ for(let dg=-1; dg<=1; dg++){ const w = (WACC + dw); const g = 4 + dg; const dr = 1 + w/100; const tv2 = terminalFcff / (w/100 - g/100); const pvterm2 = tv2 / Math.pow(dr, projYears.length); let pvfs=0; for(let i=0;i<projYears.length;i++){ pvfs += projYears[i].fcff / Math.pow(dr, i+1); } const ev = Math.round(pvfs + pvterm2); md += `|${w.toFixed(2)}%|${g.toFixed(1)}%|${ev.toLocaleString()}|\n`; }}

    md += `\n## Conclusión ejecutiva\n\n`;
    md += `Con base en los datos disponibles, la empresa presenta (auto-resumen): ingresos recientes de ${last.ingresos_operacionales.toLocaleString()} y un valor de operaciones estimado en ${enterprise.toLocaleString()} COP. Recomendaciones: profundizar en la sostenibilidad del margen EBIT y la estructura de capital para reducir el WACC.\n`;

    // Create images: revenue trend, TRM, projection FCFF
    // Create canvases
    const c1 = document.createElement('canvas'); c1.width=1200; c1.height=600;
    const c2 = document.createElement('canvas'); c2.width=1200; c2.height=600;
    const c3 = document.createElement('canvas'); c3.width=1200; c3.height=600;

    // revenue chart
    new Chart(c1.getContext('2d'), { type: 'bar', data: { labels: results.map(r=>r.anio), datasets:[{ label:'Ingresos', data: results.map(r=>r.ingresos_operacionales), backgroundColor:'#2563eb' }] }, options:{ plugins:{ legend:{display:false} }, scales:{ y:{ ticks:{ callback: v=> Number(v).toLocaleString() } } } } });
    // trm chart
    new Chart(c2.getContext('2d'), { type:'line', data:{ labels: trmYearAvg.map(t=>t.anio), datasets:[{ label:'TRM promedio', data: trmYearAvg.map(t=>t.avg), borderColor:'#0f766e', tension:0.2 }] }, options:{ plugins:{ legend:{display:false} } } });
    // projection chart
    new Chart(c3.getContext('2d'), { type:'line', data:{ labels: projYears.map(p=>p.anio), datasets:[ { label:'Ingresos proyectados', data: projYears.map(p=>p.rev), borderColor:'#1d4ed8', tension:0.2 }, { label:'FCFF', data: projYears.map(p=>p.fcff), borderColor:'#10b981', tension:0.2 } ] }, options:{ interaction:{ mode:'index', intersect:false } } });

    // convert canvases to data URLs and add to zip
    const img1 = toBase64DataUrl(c1); const img2 = toBase64DataUrl(c2); const img3 = toBase64DataUrl(c3);
    // strip header
    function dataUrlToBase64(dataUrl){ return dataUrl.split(',')[1]; }
    outputsFolder.file('trends_revenue.png', dataUrlToBase64(img1), {base64:true});
    outputsFolder.file('trends_trm.png', dataUrlToBase64(img2), {base64:true});
    outputsFolder.file('projection_fcff.png', dataUrlToBase64(img3), {base64:true});

    // Add markdown file (reference images in outputs/)
    md = md.replace('## Análisis TRM y correlación\n\n', '## Análisis TRM y correlación\n\n' + `![](outputs/trends_trm.png)\n\n`);
    md = md.replace('## Análisis de Indicadores Financieros\n\n', '## Análisis de Indicadores Financieros\n\n' + `![](outputs/trends_revenue.png)\n\n`);
    md = md.replace('## Valoración por FCL (5 años)\n\n', '## Valoración por FCL (5 años)\n\n' + `![](outputs/projection_fcff.png)\n\n`);

    outputsFolder.file('resumen.md', md);

    const content = await zip.generateAsync({type:'blob'});
    const url = URL.createObjectURL(content);
    const a = document.createElement('a'); a.href = url; a.download = 'outputs.zip'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

      zip.file('resumen.md', md);
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    // Chart.js should already be present on dashboard pages. If not, load it.
    if (typeof Chart === 'undefined') await loadScript('https://cdn.jsdelivr.net/npm/chart.js');
    const btns = Array.from(document.querySelectorAll('#download-report, #download-report-root'));
    btns.forEach(b=> b.addEventListener('click', async (e)=>{ b.disabled=true; b.textContent='Generando...'; try{ await generate(); }catch(err){ alert('Error generando informe: '+err.message); console.error(err);} b.disabled=false; b.textContent='Descargar resumen'; }));
  }

  document.addEventListener('DOMContentLoaded', initButton);
})();
