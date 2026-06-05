document.addEventListener('DOMContentLoaded', () => {
  const menuLinks = Array.from(document.querySelectorAll('.side-menu a'));
  const sections = menuLinks
    .map(a => a.getAttribute('href'))
    .filter(h => h && h.includes('#'))
    .map(h => h.split('#').pop())
    .map(id => document.getElementById(id))
    .filter(Boolean);

  // Smooth scroll for same-page hashes
  menuLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (!href) return;
      // If link includes a hash and the target exists on this page, smooth-scroll
      const parts = href.split('#');
      if (parts.length > 1) {
        const targetId = parts[1];
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
          e.preventDefault();
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // update active class
          document.querySelectorAll('.side-menu .menu-item').forEach(mi => mi.classList.remove('active'));
          const parent = link.closest('.menu-item');
          if (parent) parent.classList.add('active');
          // update location hash without jumping
          history.replaceState(null, '', '#' + targetId);
        }
      }
    });
  });

  // If the page loaded with a hash, attempt to scroll to it and mark active
  if (location.hash) {
    const hid = location.hash.replace('#', '');
    const el = document.getElementById(hid);
    if (el) {
      // Use setTimeout to allow browser to finish layout
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const menuItem = document.querySelector(`.side-menu a[href*="#${hid}"]`)?.closest('.menu-item');
        if (menuItem) {
          document.querySelectorAll('.side-menu .menu-item').forEach(mi => mi.classList.remove('active'));
          menuItem.classList.add('active');
        }
      }, 80);
    }
  }

  // Highlight menu item based on scroll position
  if (sections.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const id = entry.target.id;
        const menuItem = document.querySelector(`.side-menu a[href*="#${id}"]`)?.closest('.menu-item');
        if (entry.isIntersecting) {
          document.querySelectorAll('.side-menu .menu-item').forEach(mi => mi.classList.remove('active'));
          if (menuItem) menuItem.classList.add('active');
        }
      });
    }, { root: null, rootMargin: '-20% 0px -60% 0px', threshold: 0 });

    sections.forEach(s => observer.observe(s));
  }

  // Simple screener behavior: populate sample data from the ranking table if available
  const screenerRun = document.getElementById('screener-run');
  if (screenerRun) {
    screenerRun.addEventListener('click', () => {
      const minRev = Number(document.getElementById('screener-min-rev').value) || 0;
      const minMargin = Number(document.getElementById('screener-min-margin').value) || -999;
      const rankingRows = Array.from(document.querySelectorAll('#ranking-table tbody tr'));
      const resultsBody = document.querySelector('#screener-results tbody');
      resultsBody.innerHTML = '';
      // If no ranking rows, show a placeholder
      if (!rankingRows.length) {
        const r = document.createElement('tr');
        r.innerHTML = '<td colspan="5" style="color:var(--text-muted);">No hay datos de comparables en la tabla de ranking.</td>';
        resultsBody.appendChild(r);
        return;
      }
      let idx = 1;
      rankingRows.forEach(tr => {
        const cols = tr.querySelectorAll('td');
        if (!cols.length) return;
        const name = cols[1]?.innerText || '';
        const city = cols[2]?.innerText || '';
        const ingresosText = cols[3]?.innerText || '0';
        const ingresos = Number(ingresosText.replace(/[^0-9.-]+/g, '')) || 0;
        const marginText = cols[5]?.innerText || '0';
        const margin = Number(marginText.replace(/[^0-9.-]+/g, '')) || 0;
        if (ingresos >= minRev && margin >= minMargin) {
          const row = document.createElement('tr');
          row.innerHTML = `<td>${idx++}</td><td>${name}</td><td>${city}</td><td style="text-align:right">${(ingresos/1e6).toFixed(2)}</td><td style="text-align:right">${margin}</td>`;
          resultsBody.appendChild(row);
        }
      });
      if (!resultsBody.querySelector('tr')) {
        const r = document.createElement('tr');
        r.innerHTML = '<td colspan="5" style="color:var(--text-muted);">No se encontraron comparables con esos criterios.</td>';
        resultsBody.appendChild(r);
      }
      // scroll to results
      document.getElementById('screener')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
});
