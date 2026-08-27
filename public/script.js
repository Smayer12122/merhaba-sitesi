// Tema düğmesi, alt bilgideki yıl ve kaydırınca beliren kartlar. Başka bir şey yok.

(function () {
  const kok = document.documentElement;
  const dugme = document.querySelector('[data-tema-dugme]');

  // Telif yılı her yıl kendiliğinden güncellensin.
  const yil = document.querySelector('[data-yil]');
  if (yil) yil.textContent = new Date().getFullYear();

  function aktifTema() {
    if (kok.dataset.tema) return kok.dataset.tema;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'koyu' : 'acik';
  }

  if (dugme) {
    dugme.setAttribute('aria-pressed', String(aktifTema() === 'koyu'));

    dugme.addEventListener('click', function () {
      const yeni = aktifTema() === 'koyu' ? 'acik' : 'koyu';
      kok.dataset.tema = yeni;
      dugme.setAttribute('aria-pressed', String(yeni === 'koyu'));
      try {
        localStorage.setItem('tema', yeni);
      } catch (e) {
        // Gizli sekmede depolama kapalı olabilir; tema yine de bu sayfada değişir.
      }
    });
  }

  const hedefler = document.querySelectorAll('[data-goster]');
  if (!hedefler.length) return;

  const azHareket = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!('IntersectionObserver' in window) || azHareket) {
    hedefler.forEach(function (el) { el.classList.add('gorunur'); });
    return;
  }

  let gozlemciCalisti = false;

  const gozlemci = new IntersectionObserver(function (girisler) {
    gozlemciCalisti = true;
    girisler.forEach(function (giris, sira) {
      if (!giris.isIntersecting) return;
      setTimeout(function () { giris.target.classList.add('gorunur'); }, sira * 60);
      gozlemci.unobserve(giris.target);
    });
  }, { rootMargin: '0px 0px -60px 0px', threshold: 0.1 });

  hedefler.forEach(function (el) { gozlemci.observe(el); });

  // Güvenlik ağı: gözlemci hiç tetiklenmezse içerik gizli kalmasın.
  // Çalışan bir tarayıcıda ilk geri arama anında gelir, bu yüzden buraya düşülmez.
  setTimeout(function () {
    if (gozlemciCalisti) return;
    gozlemci.disconnect();
    hedefler.forEach(function (el) { el.classList.add('gorunur'); });
  }, 1500);
})();
