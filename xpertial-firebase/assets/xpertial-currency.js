/* ═══════════════════════════════════════════════════════════════════════
   XPERTIAL CURRENCY SYSTEM
   ─────────────────────────────────────────────────────────────────────
   • INR default for Indian users, USD for others (locale-detected)
   • Manual toggle stored in localStorage
   • Static rate, clearly marked as approximate
   • Works on pricing page, estimator, any page with data-price attrs
═══════════════════════════════════════════════════════════════════════ */

(function(){
  'use strict';

  /* ── CONFIG ── */
  var INR_TO_USD = 0.012;   // fallback static rate
var RATE_DATE  = 'Loading...';
  var LS_KEY     = 'xp_currency';

  /* ── DETECT DEFAULT ── */
  function detectDefaultCurrency(){
    try {
      var lang = navigator.language || navigator.userLanguage || '';
      var tz   = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if(lang.startsWith('en-IN') || tz.startsWith('Asia/Kolkata') || tz.startsWith('Asia/Calcutta'))
        return 'INR';
      // Also check for Indian locales
      if(['hi','bn','ta','te','mr','gu','kn','ml','pa'].some(function(l){ return lang.startsWith(l); }))
        return 'INR';
      return 'USD';
    } catch(e){ return 'INR'; }
  }

  /* ── STATE ── */
  var currentCurrency = localStorage.getItem(LS_KEY) || detectDefaultCurrency();

  /* ── FORMATTERS ── */
  function fmtINR(n){
    if(n >= 100000) return '₹' + (n/100000).toFixed(1).replace(/\.0$/,'') + 'L';
    if(n >= 1000)   return '₹' + Math.round(n/100)*100/1000 + 'K';
    return '₹' + n;
  }
  function fmtUSD(n){
    var usd = n * INR_TO_USD;
    if(usd >= 1000) return '$' + (usd/1000).toFixed(1).replace(/\.0$/,'') + 'K';
    if(usd >= 1)    return '$' + Math.round(usd);
    return '$' + usd.toFixed(2);
  }
  function fmtPricePerPt(inrVal){
    var usd = (inrVal * INR_TO_USD).toFixed(3);
    return currentCurrency === 'INR'
      ? '₹' + inrVal
      : '~$' + parseFloat(usd).toFixed(2);
  }

  /* ── RENDER ALL PRICES ── */
  function renderPrices(){
    /* data-price="15" = ₹15 per point */
    document.querySelectorAll('[data-price]').forEach(function(el){
      var inr = parseFloat(el.getAttribute('data-price'));
      if(isNaN(inr)) return;
      var isTotal = el.hasAttribute('data-price-total');
      if(isTotal){
        el.textContent = currentCurrency === 'INR' ? fmtINR(inr) : fmtUSD(inr);
      } else {
        // per data point
        var main = currentCurrency === 'INR' ? '₹'+inr : '~$'+parseFloat((inr*INR_TO_USD).toFixed(3));
        var alt  = currentCurrency === 'INR' ? '(~'+fmtUSD(inr)+')' : '(₹'+inr+')';
        el.innerHTML = '<span class="xp-price-main">'+main+'</span> <span class="xp-price-alt">'+alt+'</span>';
      }
    });

    /* data-price-range="10,20" = ₹10–₹20 */
    document.querySelectorAll('[data-price-range]').forEach(function(el){
      var parts = el.getAttribute('data-price-range').split(',');
      var lo = parseFloat(parts[0]), hi = parseFloat(parts[1]);
      if(isNaN(lo)||isNaN(hi)) return;
      if(currentCurrency === 'INR'){
        el.textContent = '₹'+lo+' – ₹'+hi;
      } else {
        var uLo = parseFloat((lo*INR_TO_USD).toFixed(3));
        var uHi = parseFloat((hi*INR_TO_USD).toFixed(3));
        el.textContent = '~$'+uLo+' – ~$'+uHi;
      }
    });

    /* data-price-total="15000" = big formatted number */
    document.querySelectorAll('[data-price-total]').forEach(function(el){
      var inr = parseFloat(el.getAttribute('data-price-total'));
      if(isNaN(inr)) return;
      el.textContent = currentCurrency === 'INR' ? fmtINR(inr) : fmtUSD(inr);
    });

    /* Update toggle buttons state */
    document.querySelectorAll('.xp-curr-btn').forEach(function(btn){
      btn.classList.toggle('active', btn.getAttribute('data-curr') === currentCurrency);
    });

    /* Update hint text */
    document.querySelectorAll('.xp-curr-hint').forEach(function(el){
      el.textContent = currentCurrency === 'USD'
        ? '~USD values are approximate. Rate: 1 INR ≈ $'+INR_TO_USD+' ('+RATE_DATE+')'
        : '';
    });

    /* Fire event so other components can react */
    document.dispatchEvent(new CustomEvent('xp:currency', {detail:{currency:currentCurrency,rate:INR_TO_USD}}));
  }

  /* ── SWITCH CURRENCY ── */
  function setCurrency(cur){
    currentCurrency = cur;
    localStorage.setItem(LS_KEY, cur);
    renderPrices();
  }

  /* ── BUILD TOGGLE WIDGET HTML ── */
  function buildToggleHTML(withHint){
    var hint = withHint ? '<span class="xp-curr-hint"></span>' : '';
    return '<div class="xp-currency-toggle" id="xpCurrToggle">'
      + '<button class="xp-curr-btn" data-curr="INR" onclick="XpCurrency.set(\'INR\')">₹ INR</button>'
      + '<button class="xp-curr-btn" data-curr="USD" onclick="XpCurrency.set(\'USD\')">$ USD</button>'
      + '</div>' + hint;
  }

  /* ── INJECT TOGGLE INTO ELEMENTS WITH data-currency-toggle ── */
  function injectToggles(){
    document.querySelectorAll('[data-currency-toggle]').forEach(function(el){
      var withHint = el.hasAttribute('data-currency-hint');
      el.innerHTML = buildToggleHTML(withHint);
    });
  }

  /* ── ESTIMATOR INTEGRATION (pricing page) ── */
  window.XpCurrency = {
    set: setCurrency,
    get: function(){ return currentCurrency; },
    toUSD: function(inr){ return inr * INR_TO_USD; },
    fmt: fmtINR,
    fmtUSD: fmtUSD,
    fmtTotal: function(inr){ return currentCurrency==='INR' ? fmtINR(inr) : fmtUSD(inr); },
    fmtRange: function(lo,hi){
      if(currentCurrency==='INR') return '₹'+lo+' – ₹'+hi;
      return '~$'+parseFloat((lo*INR_TO_USD).toFixed(2))+' – ~$'+parseFloat((hi*INR_TO_USD).toFixed(2));
    },
    rate: INR_TO_USD,
    rateDate: RATE_DATE
  };

  /* ── INIT ── */
  document.addEventListener('DOMContentLoaded', function(){
    injectToggles();
    renderPrices();
    // Fetch live rate then re-render
    fetch('https://api.frankfurter.app/latest?from=USD&to=INR')
      .then(function(r){ return r.json(); })
      .then(function(data){
        var usdToInr = data.rates.INR;
        INR_TO_USD = parseFloat((1 / usdToInr).toFixed(5));
        RATE_DATE = new Date().toLocaleDateString('en-IN',{month:'short',year:'numeric'});
        renderPrices();
      })
      .catch(function(){
        // API failed — static fallback stays active, no error shown
        RATE_DATE = 'Apr 2025 (offline)';
        renderPrices();
      });
  });

})();
