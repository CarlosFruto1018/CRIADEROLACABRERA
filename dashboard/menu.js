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
});
