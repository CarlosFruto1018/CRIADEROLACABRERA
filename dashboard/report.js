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
    // determine base path of this script so fetches work whether script is loaded from /dashboard/ or root
    let scriptBase = './';
    try {
      const cur = document.currentScript && document.currentScript.src ? document.currentScript.src : null;
      if (!cur) {
        const s = Array.from(document.getElementsByTagName('script')).reverse().find(x=>/report\.js(\?|$)/.test(x.src));
        if (s) scriptBase = s.src.replace(/\/?report\.js(\?.*)?$/, '/');
      } else {
        scriptBase = cur.replace(/\/?report\.js(\?.*)?$/, '/');
      }
    } catch (e) { scriptBase = './'; }
    const outputsFolder = zip.folder('outputs');

    const company = await fetchJson(new URL('../CRIADERO_LA_CABRERA_SAS_900433596.json', scriptBase).href);
    const benchmark = await fetchJson(new URL('../Benchmark_CRIADERO_LA_CABRERA_SAS_900433596.json', scriptBase).href);
    const trmText = await (await fetch(new URL('../TRM_Historico_5Y.csv', scriptBase).href)).text();

    // Prepare basic tables
    const fin = company.financials;
    const results = fin.estado_resultados.slice().sort((a,b)=>a.anio-b.anio);
    const years = results.map(r=>r.anio);

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

    // Projection defaults
    const last = results[results.length-1];
    const baseRevenue = last.ingresos_operacionales || 0;
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
    for(let i=1;i<=5;i++){
      rev = rev*(1+defaultGrowth);
      const ebit = rev * ebitMargin;
      const nopat = ebit*(1-taxRate);
      const da = rev*daPct;
      const capex=rev*capexPct;
      const dnwc=rev*nwcPct;
      const fcff = nopat + da - capex - dnwc;
      projYears.push({anio: last.anio + i, rev, ebit, nopat, da, capex, dnwc, fcff});
    }
    const terminalFcff = projYears[projYears.length-1].fcff*(1+0.04);
    const tv = terminalFcff / (WACC/100 - 4/100);

    // Try to load custom resumen.md provided by user
    let md = '';
    try {
      const r = await fetch(new URL('./custom_resumen.md', scriptBase).href);
      if (r.ok) md = await r.text();
    } catch (e) {
      // ignore - will auto-generate
    }

    // Auto-generate markdown if custom not provided
    if (!md) {
      md += `# Informe Ejecutivo — ${company.company.razon_social}\n\n`;
      md += `## Resumen Ejecutivo\n\n`;
      md += `- Periodo analizado: ${years[0]} - ${years[years.length-1]}\n`;
      md += `- Últimos ingresos (${last.anio}): ${last.ingresos_operacionales.toLocaleString()} ${fin.currency}\n\n`;
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

      md += `## Análisis TRM y correlación\n\n`;
      md += `Promedio anual TRM:\n\n`;
      md += `|Año|TRM promedio|\n|--:|--:|\n`;
      trmYearAvg.forEach(t=> md += `|${t.anio}|${t.avg.toFixed(2)}|\n`);
      md += `\n`;

      const common = trmYearAvg.filter(t=> years.includes(t.anio)).map(t=>({anio:t.anio,trm:t.avg,rev: results.find(r=>r.anio===t.anio).ingresos_operacionales}));
      function pearson(a,b){ const n=a.length; const ma=a.reduce((s,x)=>s+x,0)/n; const mb=b.reduce((s,x)=>s+x,0)/n; let num=0, da=0, db=0; for(let i=0;i<n;i++){ num+=(a[i]-ma)*(b[i]-mb); da+=(a[i]-ma)**2; db+=(b[i]-mb)**2; } return num/Math.sqrt(da*db); }
      let corr = 'N/A'; if (common.length>=2){ corr = pearson(common.map(x=>x.trm), common.map(x=>x.rev)).toFixed(3); }
      md += `Correlación (TRM promedio anual vs Ingresos): **${corr}**\n\n`;

      md += `## Valoración por FCL (5 años)\n\n`;
      md += `|Año|Ingresos|FCFF|Factor (WACC ${WACC.toFixed(2)}%)|PV FCFF|\n|--:|--:|--:|--:|--:|\n`;
      const discountRate = 1 + WACC/100; let pvSum=0;
      for(let i=0;i<projYears.length;i++){ const p=projYears[i]; const factor = 1/Math.pow(discountRate, i+1); const pv = p.fcff*factor; pvSum += pv; md += `|${p.anio}|${Math.round(p.rev).toLocaleString()}|${Math.round(p.fcff).toLocaleString()}|${factor.toFixed(4)}|${Math.round(pv).toLocaleString()}|\n`; }
      const pvTerminal = tv / Math.pow(discountRate, projYears.length);
      md += `|Terminal| - |${Math.round(tv).toLocaleString()}| - |${Math.round(pvTerminal).toLocaleString()}|\n\n`;
      const enterprise = Math.round(pvSum + pvTerminal);
      md += `**Valor presente de las operaciones (Enterprise Value): ${enterprise.toLocaleString()} ${fin.currency}**\n\n`;

      md += `## Conclusión ejecutiva\n\n`;
      md += `Con base en los datos disponibles, la empresa presenta (auto-resumen): ingresos recientes de ${last.ingresos_operacionales.toLocaleString()} y un valor de operaciones estimado en ${enterprise.toLocaleString()} COP.\n`;
    }

    // Create canvases and charts (Chart.js is expected to be loaded)
    const c1 = document.createElement('canvas'); c1.width=1200; c1.height=600;
    const c2 = document.createElement('canvas'); c2.width=1200; c2.height=600;
    const c3 = document.createElement('canvas'); c3.width=1200; c3.height=600;

    // append canvases off-screen so Chart.js can measure and render them properly
    const _hiddenContainer = document.createElement('div');
    _hiddenContainer.style.position = 'fixed'; _hiddenContainer.style.left = '-9999px'; _hiddenContainer.style.top = '-9999px';
    _hiddenContainer.appendChild(c1); _hiddenContainer.appendChild(c2); _hiddenContainer.appendChild(c3);
    document.body.appendChild(_hiddenContainer);

    // revenue chart
    const chart1 = new Chart(c1.getContext('2d'), { type: 'bar', data: { labels: results.map(r=>r.anio), datasets:[{ label:'Ingresos', data: results.map(r=>r.ingresos_operacionales), backgroundColor:'#2563eb' }] }, options:{ plugins:{ legend:{display:false} }, scales:{ y:{ ticks:{ callback: v=> Number(v).toLocaleString() } } } } });
    // trm chart
    const chart2 = new Chart(c2.getContext('2d'), { type:'line', data:{ labels: trmYearAvg.map(t=>t.anio), datasets:[{ label:'TRM promedio', data: trmYearAvg.map(t=>t.avg), borderColor:'#0f766e', tension:0.2 }] }, options:{ plugins:{ legend:{display:false} } } });
    // projection chart
    const chart3 = new Chart(c3.getContext('2d'), { type:'line', data:{ labels: projYears.map(p=>p.anio), datasets:[ { label:'Ingresos proyectados', data: projYears.map(p=>p.rev), borderColor:'#1d4ed8', tension:0.2 }, { label:'FCFF', data: projYears.map(p=>p.fcff), borderColor:'#10b981', tension:0.2 } ] }, options:{ interaction:{ mode:'index', intersect:false } } });

    // ensure charts have rendered before extracting images
    await new Promise(resolve => requestAnimationFrame(resolve));

    // use Chart.js helper to get fully rendered image data URLs
    const img1 = (typeof chart1.toBase64Image === 'function') ? chart1.toBase64Image() : toBase64DataUrl(c1);
    const img2 = (typeof chart2.toBase64Image === 'function') ? chart2.toBase64Image() : toBase64DataUrl(c2);
    const img3 = (typeof chart3.toBase64Image === 'function') ? chart3.toBase64Image() : toBase64DataUrl(c3);

    // remove hidden canvases from DOM
    _hiddenContainer.remove();
    function dataUrlToBase64(dataUrl){ return dataUrl.split(',')[1]; }
    outputsFolder.file('trends_revenue.png', dataUrlToBase64(img1), {base64:true});
    outputsFolder.file('trends_trm.png', dataUrlToBase64(img2), {base64:true});
    outputsFolder.file('projection_fcff.png', dataUrlToBase64(img3), {base64:true});

    // Add top-level images with names used in custom resumen so links resolve
    zip.file('fig1_ingresos_utilidad.png', dataUrlToBase64(img1), {base64:true});
    zip.file('fig2_indicadores.png', dataUrlToBase64(img1), {base64:true});
    zip.file('fig3_benchmark.png', dataUrlToBase64(img1), {base64:true});
    zip.file('fig4_trm_vs_ingresos.png', dataUrlToBase64(img2), {base64:true});
    zip.file('fig5_fcff.png', dataUrlToBase64(img3), {base64:true});
    zip.file('fig6_sensibilidad.png', dataUrlToBase64(img3), {base64:true});

    // Attempt to include any user-provided images placed in ./images/
    // First, prefer an explicit manifest at ./images/manifest.json listing filenames (array).
    try {
      let urls = [];
      try {
        const m = await fetch(new URL('./images/manifest.json', scriptBase).href);
        if (m.ok) {
          const list = await m.json();
          if (Array.isArray(list)) {
            urls = list.map(name => new URL(name, location.href).href);
          } else if (list && typeof list === 'object') {
            // manifest as mapping: {"zipName.png":"sourceName.jpg", ...}
            // convert to array of objects for predictable naming
            const entries = Object.entries(list).map(([zipName, src]) => ({zipName, url: new URL('./images/' + src, location.href).href}));
            // handle entries separately below
            urls = entries;
          }
        }
      } catch (e) {
        // manifest missing or invalid — fallback to directory listing
      }

      if (urls.length === 0) {
        // fallback: try to parse a public directory listing at ./images/
        try {
          const imgsIndex = await fetch(new URL('./images/', scriptBase).href);
          if (imgsIndex.ok) {
            const html = await imgsIndex.text();
            try {
              const doc = new DOMParser().parseFromString(html, 'text/html');
              const elems = Array.from(doc.querySelectorAll('a, img'));
              elems.forEach(el => {
                const ref = el.getAttribute('href') || el.getAttribute('src');
                if (!ref) return;
                if (/\.(png|jpe?g|gif|svg)(\?|$)/i.test(ref)) {
                  const abs = new URL(ref, location.href).href;
                  urls.push(abs);
                }
              });
            } catch (e) {
              // fallback: regex
              const re = /href=["']([^"']+\.(?:png|jpe?g|gif|svg))(?:["'])/ig;
              let mm;
              while ((mm = re.exec(html))) urls.push(new URL(mm[1], location.href).href);
            }
          }
        } catch (e) { /* ignore */ }
      }

      // dedupe while preserving possible mapping objects
      if (urls.length && typeof urls[0] === 'string') {
        urls = Array.from(new Set(urls));
      } else if (urls.length && typeof urls[0] === 'object') {
        const seen = new Set();
        urls = urls.filter(e => { if (seen.has(e.url)) return false; seen.add(e.url); return true; });
      }
      async function blobToBase64(blob){
        return await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result.split(',')[1]);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
      }

      for (const item of urls) {
        try {
          if (typeof item === 'string') {
            const r = await fetch(item);
            if (!r.ok) continue;
            const blob = await r.blob();
            const b64 = await blobToBase64(blob);
            const name = decodeURIComponent(item.split('/').pop().split('?')[0]);
            zip.file('images/' + name, b64, {base64:true});
            outputsFolder.file('images/' + name, b64, {base64:true});
          } else if (item && typeof item === 'object') {
            const r = await fetch(item.url);
            if (!r.ok) continue;
            const blob = await r.blob();
            const b64 = await blobToBase64(blob);
            const zipName = (item.zipName || decodeURIComponent(item.url.split('/').pop().split('?')[0]));
            // save with desired zip name
            zip.file(zipName, b64, {base64:true});
            outputsFolder.file(zipName, b64, {base64:true});
          }
        } catch (e) { console.warn('Could not include image', item, e); }
      }
    } catch (e) { console.warn('images inclusion failed', e); }

    // Write resumen.md both at root and inside outputs/ for compatibility
    zip.file('resumen.md', md);
    outputsFolder.file('resumen.md', md);

    const content = await zip.generateAsync({type:'blob'});
    const url = URL.createObjectURL(content);
    const a = document.createElement('a'); a.href = url; a.download = 'outputs.zip'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  async function initButton(){
    // ensure JSZip and Chart.js are available
    try{
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    }catch(e){ console.warn('Could not load JSZip:', e); }
    if (typeof Chart === 'undefined'){
      try{ await loadScript('https://cdn.jsdelivr.net/npm/chart.js'); } catch(e){ console.warn('Could not load Chart.js:', e); }
    }

    const btns = Array.from(document.querySelectorAll('#download-report, #download-report-root'));
    btns.forEach(b=> b.addEventListener('click', async (e)=>{ 
      const orig = b.textContent;
      try{ b.disabled=true; b.textContent='Generando...'; await generate(); }
      catch(err){ alert('Error generando informe: '+err.message); console.error(err); }
      finally{ b.disabled=false; b.textContent=orig; }
    }));
  }

  document.addEventListener('DOMContentLoaded', initButton);
})();
