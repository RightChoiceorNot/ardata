// ── 動態載入大型資料 ──
var _loadPromises = [];
var _PERSONAL_UNIFIED = null;
var _DONOR_UNIFIED    = null;
var _PERSONAL_DATA_2024 = null;

function _fetchJSON(url, callback) {
  var p = fetch(url).then(function(r){ return r.json(); }).then(callback)
    .catch(function(e){ console.warn('載入失敗：'+url, e); });
  _loadPromises.push(p);
  return p;
}

// 三個 personal 檔案 + 兩個 donor 檔案，全部完成才顯示畫面
var _pPersonal = Promise.all([
  fetch('personal_unified.json').then(function(r){ return r.json(); }),
  fetch('personal_unified_2.json').then(function(r){ return r.json(); }),
  fetch('personal_unified_3.json').then(function(r){ return r.json(); })
]).then(function(results){
  _PERSONAL_UNIFIED = results[0].concat(results[1], results[2]);
  _buildPersIndexes(_PERSONAL_UNIFIED);
  _buildPartyPersIndex(_PERSONAL_UNIFIED);
  _buildCandidatePersIdx(_PERSONAL_UNIFIED);
}).catch(function(e){ console.warn('personal 資料載入失敗', e); });

var _pDonor = Promise.all([
  fetch('donor_unified.json').then(function(r){ return r.json(); }),
  fetch('donor_unified_2.json').then(function(r){ return r.json(); })
]).then(function(results){
  _DONOR_UNIFIED = results[0].concat(results[1]);
  _buildPartyCorpIndex(_DONOR_UNIFIED);
  _buildCorpByName(_DONOR_UNIFIED);
}).catch(function(e){ console.warn('donor 資料載入失敗', e); });

// 全部完成後移除載入遮罩
Promise.all([_pPersonal, _pDonor]).then(function(){
  var overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.style.opacity = '0';
  setTimeout(function(){ overlay.remove(); }, 420);
}).catch(function(){
  var overlay = document.getElementById('loading-overlay');
  if (overlay) { overlay.style.opacity = '0'; setTimeout(function(){ overlay.remove(); }, 420); }
});

// 2018/2020 corp_data lazy fetch（切換時才載入）
window._CORP_DATA_2018 = null;
window._CORP_DATA_2020 = null;
window._CORP_DATA_2018_loaded = false;
window._CORP_DATA_2020_loaded = false;

function _loadCorpData2018(cb) {
  if (_CORP_DATA_2018_loaded) { if (cb) cb(); return; }
  _fetchJSON('corp_data_2018.json', function(d) {
    window._CORP_DATA_2018 = d;
    window._CORP_DATA_2018_loaded = true;
    if (cb) cb();
  });
}
function _loadCorpData2020(cb) {
  if (_CORP_DATA_2020_loaded) { if (cb) cb(); return; }
  _fetchJSON('corp_data_2020.json', function(d) {
    window._CORP_DATA_2020 = d;
    window._CORP_DATA_2020_loaded = true;
    if (cb) cb();
  });
}


// ══ 政黨頁面（完全獨立） ══
var activeParty     = null;
var activePartyYr   = '113';
var partySearchQ    = '';
var activePartyTab  = 'corp';
var activePartyMainTab = 'rank';  // rank | donor
var partyDonorQ     = '';

// ── 公司名稱字形正規化（異體字對應表，需要時逐一補充） ──
function _normName(s) {
  if (!s) return '';
  // 覧 (U+89A7) → 覽 (U+89BD)
  return s.replace(/覧/g, '覽');
}

// ── 全域捐款索引 ──
var _CORP_IDX = null;
var _ORG_IDX  = null;
var _PERS_IDX = null;
// 企業名稱查詢索引（名稱 → _DONOR_UNIFIED 完整物件）
var _CORP_BY_NAME = null;
// 個人候選人反向索引（persKey → 所捐候選人）
var _PERS_CAND_IDX = null;

function persKey(item) {
  // 個人比對 key：姓名 + 遮罩身分證 + 遮罩地址（前8碼）
  var name = (item.name || '').trim();
  var id   = (item.id   || '').trim();
  var addr = (item.addr || '').trim().slice(0, 8);
  return name + '|' + id + '|' + addr;
}

function buildDonorIndex() {
  if (_CORP_IDX) return;
  _CORP_IDX = {};
  _ORG_IDX  = {};
  _PERS_IDX = {};

  Object.keys(_PARTY_DATA).forEach(function(pname) {
    var pd = _PARTY_DATA[pname];
    Object.keys(pd.years).forEach(function(yr) {
      var yrd = pd.years[yr];

      // 企業：key = 統一編號（8碼數字）
      (yrd.corp_items || []).forEach(function(item) {
        var key = (item.id || '').trim();
        if (!key || key === 'nan' || !/^\d{8}$/.test(key)) return;
        if (!_CORP_IDX[key]) _CORP_IDX[key] = [];
        _CORP_IDX[key].push({party:pname, year:yr, name:item.name,
                              amt:item.amt, addr:item.addr, date:item.date});
      });

      // 人民團體：key = 統一編號
      (yrd.org_items || []).forEach(function(item) {
        var key = (item.id || '').trim();
        if (!key || key === 'nan' || !/^\d{8}$/.test(key)) return;
        if (!_ORG_IDX[key]) _ORG_IDX[key] = [];
        _ORG_IDX[key].push({party:pname, year:yr, name:item.name,
                             amt:item.amt, addr:item.addr, date:item.date});
      });

      // 個人：key = 姓名 + 遮罩身分證 + 遮罩地址前8碼
      (yrd.pers_items || []).forEach(function(item) {
        var key = persKey(item);
        if (!key || key === '||') return;
        if (!_PERS_IDX[key]) _PERS_IDX[key] = [];
        _PERS_IDX[key].push({party:pname, year:yr, name:item.name,
                              amt:item.amt, addr:item.addr, date:item.date});
      });
    });
  });
}

// ── 初始化 ──
function initPartyPage() {
  var el = document.getElementById('page-party');
  if (!el || el.dataset.init) return;
  el.dataset.init = '1';
  buildDonorIndex();
  renderPartyList('');
  var totalEl = document.getElementById('party-total-count');
  if (totalEl) totalEl.textContent = Object.keys(_PARTY_DATA).length;
  // 左側政黨搜尋欄：純 input 事件，跟候選人頁一致
  var ps = document.getElementById('party-search');
  if (ps) ps.addEventListener('input', function(){ filterPartyList(this.value); });
  // 手機版：party-main 由 CSS transform 控制，不用 display
}

var _plTimer = null;
function _plInput(el) {
  clearTimeout(_plTimer);
  var val = el.value;
  _plTimer = setTimeout(function(){ filterPartyList(val); }, 500);
}
function filterPartyList(q) {
  partySearchQ = q;
  renderPartyList(q);
}

function renderPartyList(q) {
  var listEl = document.getElementById('party-list');
  var metaEl = document.getElementById('party-list-meta');
  if (!listEl) return;
  var qLow  = q.toLowerCase().trim();
  var names = Object.keys(_PARTY_DATA).filter(function(n) {
    return !qLow || n.includes(qLow);
  });
  if (metaEl) metaEl.textContent = '共 ' + names.length + ' 個政黨';
  listEl.innerHTML = names.map(function(name) {
    var pd    = _PARTY_DATA[name];
    var color = pd.color || {bg:'#9e9e9e', text:'#fff'};
    var latestYr = ['113','112','111'].find(function(y){ return pd.years[y]; });
    var inc   = latestYr ? (pd.years[latestYr].r1['收入合計'] || 0) : 0;
    var isSel = name === activeParty;
    return '<div class="party-item' + (isSel ? ' active' : '') +
      '" onclick="selectParty(\'' + name.replace(/'/g, "\\'") + '\')">' +
      '<div class="party-icon" style="background:' + color.bg + ';color:' + color.text + '">' +
      name.slice(0, 2) + '</div>' +
      '<div style="flex:1;min-width:0">' +
      '<div class="party-name">' + name + '</div>' +
      '<div class="party-income">收入 ' + pFmtAmt(inc) + '</div>' +
      '</div></div>';
  }).join('');
}

function selectParty(name) {
  activeParty        = name;
  activePartyTab     = 'corp';
  activePartyMainTab = 'rank';
  partyDonorQ        = '';
  var pd = _PARTY_DATA[name];
  activePartyYr  = ['113','112','111'].find(function(y){ return pd.years[y]; }) || '113';
  _partyRankYr   = activePartyYr;  // 同步排名年份
  renderPartyList(partySearchQ);
  renderPartyDetail();
  // 手機版：全螢幕滑入
  if (window.innerWidth <= 900) {
    var pm = document.getElementById('party-main');
    if (pm) {
      pm.scrollTop = 0;
      requestAnimationFrame(function() { pm.classList.add('mobile-visible'); });
    }
    var backBtn = document.getElementById('party-back-btn');
    if (backBtn) backBtn.style.display = 'flex';
  }
}

// 捐款來源頁類型 sheet
function openDonorTypeSheet() {
  // 更新 radio 選中狀態和樣式
  var opts = {
    corp: document.getElementById('donor-type-opt-corp'),
    pers: document.getElementById('donor-type-opt-pers'),
  };
  ['corp','pers'].forEach(function(t) {
    var el = opts[t];
    var radio = el ? el.querySelector('input') : null;
    var span  = el ? el.querySelector('span') : null;
    var isActive = t === (typeof _donorTab !== 'undefined' ? _donorTab : 'corp');
    if (radio) radio.checked = isActive;
    if (el) {
      el.style.borderColor = isActive ? 'var(--accent)' : 'var(--border)';
      el.style.background  = isActive ? 'var(--accent-lt)' : 'transparent';
    }
    if (span) {
      span.style.fontWeight = isActive ? '700' : '500';
      span.style.color      = isActive ? 'var(--accent)' : 'var(--text)';
    }
  });
  var overlay = document.getElementById('donor-type-sheet-overlay');
  var sheet   = document.getElementById('donor-type-sheet');
  if (!overlay || !sheet) return;
  overlay.style.display = 'block';
  setTimeout(function() {
    overlay.style.opacity = '1';
    sheet.style.transform = 'translateY(0)';
  }, 10);
}

function closeDonorTypeSheet() {
  var overlay = document.getElementById('donor-type-sheet-overlay');
  var sheet   = document.getElementById('donor-type-sheet');
  if (!overlay || !sheet) return;
  overlay.style.opacity = '0';
  sheet.style.transform = 'translateY(100%)';
  setTimeout(function() { overlay.style.display = 'none'; }, 300);
}

function applyDonorTypeSheet() {
  var checked = document.querySelector('input[name="donor-type-radio"]:checked');
  if (checked && typeof switchDonorTab === 'function') switchDonorTab(checked.value);
  closeDonorTypeSheet();
}

// 地方/總統立委頁年份 sheet
var _electionYrOptions = {
  'local':    [['2022','2022年地方選舉']],
  'national': [['2024','2024年總統立委'],['2020','2020年總統立委']]
};

function openElectionYrSheet() {
  // 依目前頁面（local/national）決定選項
  var _isNational = (typeof isNational !== 'undefined') ? isNational : false;
  var _navNational = document.getElementById('nav-national');
  var _pageIsNational = _navNational && _navNational.style.background &&
    _navNational.style.background.indexOf('var(--accent)') !== -1;
  var opts = _pageIsNational
    ? [['2024','2024年總統立委'],['2020','2020年總統立委']]
    : [['2022','2022年地方選舉'],['2018','2018年地方選舉']];
  var overlay = document.getElementById('election-yr-sheet-overlay');
  var sheet   = document.getElementById('election-yr-sheet');
  var body    = document.getElementById('election-yr-sheet-body');
  if (!overlay || !sheet || !body) return;
  body.innerHTML = opts.map(function(opt) {
    var val = opt[0], label = opt[1];
    var isActive = val === CURRENT_ELECTION;
    return '<label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;' +
      'background:' + (isActive ? 'var(--accent-lt)' : 'transparent') + ';' +
      'border:1.5px solid ' + (isActive ? 'var(--accent)' : 'var(--border)') + '">' +
      '<input type="radio" name="election-yr-radio" value="' + val + '"' + (isActive ? ' checked' : '') +
      ' style="accent-color:var(--accent)">' +
      '<span style="font-size:.88rem;font-weight:' + (isActive ? '700' : '500') + ';color:' +
      (isActive ? 'var(--accent)' : 'var(--text)') + '">' + label + '</span>' +
    '</label>';
  }).join('');
  overlay.style.display = 'block';
  setTimeout(function() {
    overlay.style.opacity = '1';
    sheet.style.transform = 'translateY(0)';
  }, 10);
}

function closeElectionYrSheet() {
  var overlay = document.getElementById('election-yr-sheet-overlay');
  var sheet   = document.getElementById('election-yr-sheet');
  if (!overlay || !sheet) return;
  overlay.style.opacity = '0';
  sheet.style.transform = 'translateY(100%)';
  setTimeout(function() { overlay.style.display = 'none'; }, 300);
}

function applyElectionYrSheet() {
  var checked = document.querySelector('input[name="election-yr-radio"]:checked');
  if (checked) switchElection(checked.value);
  closeElectionYrSheet();
}

function openPartyYrSheet() {
  var availYrs = window._partyAvailYrs || [];
  var overlay = document.getElementById('party-yr-sheet-overlay');
  var sheet   = document.getElementById('party-yr-sheet');
  var body    = document.getElementById('party-yr-sheet-body');
  if (!overlay || !sheet || !body) return;
  var _yrMap = {'107':'2018','108':'2019','109':'2020','110':'2021','111':'2022','112':'2023','113':'2024'};
  body.innerHTML = availYrs.map(function(y) {
    var label   = _yrMap[y] || y;
    var isActive = y === activePartyYr;
    return '<label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;' +
      'background:' + (isActive ? 'var(--accent-lt)' : 'transparent') + ';' +
      'border:1.5px solid ' + (isActive ? 'var(--accent)' : 'var(--border)') + '">' +
      '<input type="radio" name="party-yr-radio" value="' + y + '"' + (isActive ? ' checked' : '') +
      ' style="accent-color:var(--accent)">' +
      '<span style="font-size:.88rem;font-weight:' + (isActive ? '700' : '500') + ';color:' +
      (isActive ? 'var(--accent)' : 'var(--text)') + '">' + label + ' 年</span>' +
    '</label>';
  }).join('');
  overlay.style.display = 'block';
  setTimeout(function() {
    overlay.style.opacity = '1';
    sheet.style.transform = 'translateY(0)';
  }, 10);
}

function closePartyYrSheet() {
  var overlay = document.getElementById('party-yr-sheet-overlay');
  var sheet   = document.getElementById('party-yr-sheet');
  if (!overlay || !sheet) return;
  overlay.style.opacity  = '0';
  sheet.style.transform  = 'translateY(100%)';
  setTimeout(function() { overlay.style.display = 'none'; }, 300);
}

function applyPartyYrSheet() {
  var checked = document.querySelector('input[name="party-yr-radio"]:checked');
  if (checked) switchPartyYear(checked.value);
  closePartyYrSheet();
}

function switchPartyYear(yr) {
  activePartyYr  = yr;
  activePartyTab = 'corp';
  partyDonorQ    = '';
  renderPartyDetail();
}


function switchPartyMainTab(tab) {
  activePartyMainTab = tab;
  var rankEl   = document.getElementById('party-rank-section');
  var donorEl  = document.getElementById('party-donor-panel');
  var btnRank  = document.getElementById('pmain-rank');
  var btnDonor = document.getElementById('pmain-donor');
  if (rankEl)  rankEl.style.display  = tab === 'rank'  ? '' : 'none';
  if (donorEl) donorEl.style.display = tab === 'donor' ? '' : 'none';
  if (btnRank)  btnRank.classList.toggle('active',  tab === 'rank');
  if (btnDonor) btnDonor.classList.toggle('active', tab === 'donor');
  if (tab === 'rank' && typeof renderPartyRank === 'function') {
    _partyRankYr  = activePartyYr;
    renderPartyRank();
  }
  if (tab === 'donor') {
    renderDonorSection();
  }
}

function switchPartyTab(tab) {
  activePartyTab = tab;
  partyDonorQ = '';
  var si = document.getElementById('party-donor-search');
  if (si) si.value = '';
  if (tab === 'rank') {
    _partyRankYr = activePartyYr;
    renderPartyRank();
    // 更新 Tab 高亮（renderDonorSection 會做，rank 要自己做）
    ['corp','org','pers','rank'].forEach(function(t) {
      var btn = document.getElementById('ptab-' + t);
      if (btn) btn.classList.toggle('active', t === tab);
    });
    return;
  }
  renderDonorSection();
  ['corp','org','pers'].forEach(function(t) {
    var btn = document.getElementById('ptab-' + t);
    if (btn) btn.className = 'donor-tab-btn' + (t === tab ? ' active' : '');
  });
}

var _pdTimer = null;
function _pdInput(el) {
  clearTimeout(_pdTimer);
  var val = el.value;
  _pdTimer = setTimeout(function(){ filterPartyDonor(val); }, 500);
}
function filterPartyDonor(q) {
  partyDonorQ = (q || '').toLowerCase().trim();
  renderDonorSection();
}

// ── 格式化 ──
function pFmtAmt(n) {
  if (!n || n === 0) return '—';
  if (n >= 1e8) return (n/1e8).toFixed(1) + ' 億';
  if (n >= 1e4) return Math.round(n/1e4) + ' 萬';
  return n.toLocaleString();
}
function pFmtAmtFull(n) {
  if (!n && n !== 0) return '—';
  if (n === 0) return '—';
  return '$ ' + Math.round(n).toLocaleString();
}
function pFmtDate(d) {
  if (!d) return '';
  var s = String(Math.round(d));
  if (s.length === 7) {
    return s.slice(0,3) + '/' + s.slice(3,5) + '/' + s.slice(5,7);
  }
  return d;
}

var _ALSO_YR_LABELS = {'2018':'2018地方選舉','2020':'2020總統立委','2022':'2022地方選舉','2024':'2024總統立委','party':'政黨'};
var _ALSO_YR_ORDER  = ['2024','2022','2020','2018','party'];

// ── 組建「也捐給」區塊 HTML（供 renderDonorRow 與 renderDonorSection 共用） ──
function _buildAlsoGaveHtml(item, curParty, curYr) {
  var candByYr = {};
  var partyMap = {};

  if (activePartyTab === 'corp' || activePartyTab === 'org') {
    var donorEntry = _CORP_BY_NAME && _CORP_BY_NAME[_normName((item.name || '').trim())];
    if (donorEntry && donorEntry.sources) {
      ['2018','2020','2022','2024'].forEach(function(yr) {
        if (!donorEntry.sources[yr]) return;
        donorEntry.sources[yr].items.forEach(function(it) {
          var cn = it.cand || ''; if (!cn) return;
          if (!candByYr[yr]) candByYr[yr] = {};
          if (!candByYr[yr][cn]) candByYr[yr][cn] = { city: it.city||'', party: it.party||'', amt: 0 };
          candByYr[yr][cn].amt += it.amt;
        });
      });
      if (donorEntry.sources.party) {
        var curYrInt = parseInt(curYr);
        donorEntry.sources.party.items.forEach(function(it) {
          if (!it.cand || (it.cand === curParty && parseInt(it.yr) === curYrInt)) return;
          if (!partyMap[it.cand]) partyMap[it.cand] = { yrs: [], yr_labels: [], totalAmt: 0 };
          var y = parseInt(it.yr);
          if (!partyMap[it.cand].yrs.includes(y)) {
            partyMap[it.cand].yrs.push(y);
            partyMap[it.cand].yr_labels.push(it.yr_label || String(y + 1911));
          }
          partyMap[it.cand].totalAmt += it.amt;
        });
      }
    }
  } else {
    var key = persKey(item);
    (_PERS_IDX && _PERS_IDX[key] || [])
      .filter(function(r){ return !(r.party === curParty && String(r.year) === String(curYr)); })
      .forEach(function(r) {
        if (!partyMap[r.party]) partyMap[r.party] = { yrs: [], yr_labels: [], totalAmt: 0 };
        if (!partyMap[r.party].yrs.includes(r.year)) {
          partyMap[r.party].yrs.push(r.year);
          partyMap[r.party].yr_labels.push(r.yr_label || String(parseInt(r.year) + 1911));
        }
        partyMap[r.party].totalAmt += r.amt;
      });
    (_PERS_CAND_IDX && _PERS_CAND_IDX[key] || []).forEach(function(r) {
      if (!candByYr[r.yr]) candByYr[r.yr] = {};
      if (!candByYr[r.yr][r.cand]) candByYr[r.yr][r.cand] = { city: r.city||'', party: r.party||'', amt: 0 };
      candByYr[r.yr][r.cand].amt += r.amt;
    });
  }

  var rows = _ALSO_YR_ORDER.filter(function(yr) {
    return yr === 'party'
      ? Object.keys(partyMap).length > 0
      : (candByYr[yr] && Object.keys(candByYr[yr]).length > 0);
  }).map(function(yr) {
    var yrLabel = '<span style="font-size:.62rem;color:var(--muted);white-space:nowrap;margin-right:2px">' +
      _ALSO_YR_LABELS[yr] + '：</span>';
    var tags = '';
    if (yr === 'party') {
      tags = Object.keys(partyMap).map(function(pname) {
        var r = partyMap[pname];
        var pd = _PARTY_DATA[pname];
        var bg = pd ? pd.color.bg : '#9e9e9e';
        var yrStr = r.yr_labels.sort(function(a,b){return parseInt(a)-parseInt(b);}).join('、') + '年';
        return '<span style="display:inline-flex;align-items:center;gap:3px;' +
          'background:' + bg + '18;border:1px solid ' + bg + '44;' +
          'border-radius:4px;padding:1px 7px;font-size:.68rem;white-space:nowrap">' +
          '<span style="color:' + bg + ';font-weight:700">' + pname + '</span>' +
          '<span style="color:var(--sub)">' + yrStr + '</span>' +
          '<span style="color:var(--accent);font-weight:600">' + pFmtAmtFull(r.totalAmt) + '</span>' +
          '</span>';
      }).join('');
    } else {
      tags = Object.keys(candByYr[yr])
        .sort(function(a,b){ return candByYr[yr][b].amt - candByYr[yr][a].amt; })
        .map(function(cname) {
          var r = candByYr[yr][cname];
          var pd2 = r.party && _PARTY_DATA[r.party];
          var bg2 = pd2 ? pd2.color.bg : '#9e9e9e';
          return '<span style="display:inline-flex;align-items:center;gap:3px;' +
            'background:' + bg2 + '18;border:1px solid ' + bg2 + '44;' +
            'border-radius:4px;padding:1px 7px;font-size:.68rem;white-space:nowrap">' +
            '<span style="color:' + bg2 + ';font-weight:700">' + cname + '</span>' +
            (r.city ? '<span style="color:var(--sub)">(' + r.city + ')</span>' : '') +
            '</span>';
        }).join('');
    }
    return '<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding-left:2px">' +
      yrLabel + tags + '</div>';
  });

  return rows.length
    ? '<div style="margin-top:5px;padding-left:2px">' +
        '<span style="font-size:.67rem;color:var(--muted)">也捐給：</span>' +
        rows.join('') +
      '</div>'
    : '';
}

// ── 單筆捐款行（含跨黨/跨候選人比對標籤） ──
function renderDonorRow(item, curParty, curYr, skipAlso) {
  if (activePartyTab === 'rank') {
    renderPartyRank();
    return;
  }

  var otherHtml = skipAlso ? '' : _buildAlsoGaveHtml(item, curParty, curYr);

  return '<div class="donor-row" style="' + (otherHtml ? 'flex-direction:column;align-items:flex-start;' : '') + '">' +
    '<div style="display:flex;align-items:center;width:100%;gap:10px">' +
      '<div class="donor-name">' + (item.name || '') + '</div>' +
      '<div style="font-size:.68rem;color:var(--muted);white-space:nowrap">' +
        (item.addr ? item.addr.slice(0, 6) : '') + '</div>' +
      '<div class="donor-date">' + pFmtDate(item.date) + '</div>' +
      '<div class="donor-amt">' + pFmtAmtFull(item.amt) + '</div>' +
    '</div>' +
    otherHtml +
  '</div>';
}

// ── 渲染捐款分頁（含搜尋） ──
function renderDonorSection() {
  var el = document.getElementById('party-donor-list');
  if (!el || !activeParty) return;

  var pd  = _PARTY_DATA[activeParty];
  var yrd = pd ? pd.years[activePartyYr] : null;
  if (!yrd) { el.innerHTML = ''; return; }

  var corpItems = yrd.corp_items || [];
  var orgItems  = yrd.org_items  || [];
  var persItems = yrd.pers_items || [];

  var items, emptyMsg, totalLabel;

  if (activePartyTab === 'corp') {
    items      = corpItems;
    emptyMsg   = '無營利事業捐贈紀錄';
    totalLabel = '營利事業捐贈（' + items.length + ' 筆，合計 ' + pFmtAmtFull(yrd.corp_total) + '）';
  } else if (activePartyTab === 'org') {
    items      = orgItems;
    emptyMsg   = '無人民團體捐贈紀錄';
    totalLabel = '人民團體捐贈（' + items.length + ' 筆，合計 ' + pFmtAmtFull(yrd.org_total) + '）';
  } else {
    items      = persItems;
    emptyMsg   = '無 10 萬以上個人捐款紀錄';
    totalLabel = '個人捐贈 ≥ 10萬（' + items.length + ' 筆）' +
      '<span style="font-size:.65rem;color:var(--muted);font-weight:400;margin-left:6px">' +
      '政黨個人捐款上限 30 萬，僅顯示 ≥ 10 萬筆數</span>';
  }

  // 更新標題
  var titleEl = document.getElementById('party-donor-title');
  if (titleEl) titleEl.innerHTML = totalLabel;

  // 合併同名捐款者（以正規化名稱為 key，避免異體字導致不合併）
  var mergedMap = {};
  items.forEach(function(item) {
    var k = _normName((item.name || '').trim());
    if (!mergedMap[k]) mergedMap[k] = Object.assign({}, item, { total: 0, multiItems: [] });
    mergedMap[k].total += item.amt;
    mergedMap[k].multiItems.push(item);
  });
  Object.values(mergedMap).forEach(function(m) {
    m.amt = m.total;
    m.multiItems.sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });
  });
  var mergedItems = Object.values(mergedMap).sort(function(a,b){ return b.total - a.total; });

  // 套用搜尋過濾
  var filtered = partyDonorQ
    ? mergedItems.filter(function(item) {
        return (item.name || '').toLowerCase().includes(partyDonorQ) ||
               (item.addr || '').toLowerCase().includes(partyDonorQ);
      })
    : mergedItems;

  // 更新搜尋結果計數
  var countEl = document.getElementById('party-donor-count');
  if (countEl) {
    countEl.textContent = partyDonorQ
      ? '搜尋結果：' + filtered.length + ' / ' + items.length + ' 筆'
      : '';
  }

  el.innerHTML = filtered.length
    ? filtered.map(function(item) {
        // 多筆展開：順序為 header → 逐筆明細 → 也捐給
        if (item.multiItems && item.multiItems.length > 1) {
          var baseRow = renderDonorRow(item, activeParty, activePartyYr, true);
          var multiHtml = '<div style="margin:2px 0 6px 0;padding-left:8px;border-left:2px solid var(--border)">' +
            item.multiItems.map(function(it) {
              var retT = it.ret&&it.ret.includes('返還') ? '<span style="font-size:.6rem;background:#fef2f2;color:#ef4444;padding:1px 4px;border-radius:6px;margin-left:4px">已返還</span>' : '';
              return '<div style="display:flex;align-items:center;gap:8px;padding:2px 0;font-size:.78rem;color:var(--sub)">' +
                '<span style="color:var(--muted)">' + pFmtDate(it.date||'') + '</span>' +
                '<span style="margin-left:auto;font-family:var(--mono);font-weight:600">' + pFmtAmtFull(it.amt) + '</span>' +
                retT + '</div>';
            }).join('') + '</div>';
          var alsoHtml = _buildAlsoGaveHtml(item, activeParty, activePartyYr);
          return '<div>' + baseRow + multiHtml + alsoHtml + '</div>';
        }
        return renderDonorRow(item, activeParty, activePartyYr);
      }).join('')
    : '<div style="color:var(--muted);font-size:.82rem;padding:10px 0">' +
        (partyDonorQ ? '查無符合「' + partyDonorQ + '」的紀錄' : emptyMsg) +
      '</div>';
}

// ── 渲染政黨詳細頁 ──
function renderPartyDetail() {
  var detEl = document.getElementById('party-detail');
  if (!detEl || !activeParty) return;

  var pd    = _PARTY_DATA[activeParty];
  var yrd   = pd.years[activePartyYr];
  var color = pd.color || {bg:'#9e9e9e', text:'#fff', light:'#f5f5f5'};

  if (!yrd) {
    detEl.innerHTML = '<div class="p-section"><div style="color:var(--sub);font-size:.85rem;' +
      'padding:20px 0;text-align:center">' + activeParty + ' 在 ' + activePartyYr +
      ' 年（民國）無申報資料</div></div>';
    return;
  }

  var r1  = yrd.r1;
  var inc = r1['收入合計']  || 0;
  var exp = r1['支出合計']  || 0;
  var bal = r1['本期結餘'] || 0;
  var balCls  = bal >= 0 ? 'p-green' : 'p-red';
  var balSign = bal >= 0 ? '+' : '';

  // 年份下拉選單（動態從 pd.years 產生，降序排列）
  var _yrMap = {'107':'2018','108':'2019','109':'2020','110':'2021','111':'2022','112':'2023','113':'2024'};
  var availYrs = Object.keys(pd.years).filter(function(y){ return pd.years[y] && pd.years[y].r1; }).sort(function(a,b){ return b-a; });
  var _yrLabel = _yrMap[activePartyYr] || activePartyYr;
  window._partyAvailYrs = availYrs;
  var yrBtns = '<button onclick="openPartyYrSheet()" ' +
    'id="party-yr-btn" ' +
    'style="display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:6px;' +
    'border:1.5px solid var(--border);background:var(--surface2);color:var(--text);' +
    'font-size:.78rem;font-family:var(--sans);font-weight:500;cursor:pointer;white-space:nowrap">' +
    '📅 ' + _yrLabel +
  '</button>';

  // 收入結構
  var incItems = [
    {label:'個人捐贈', val: r1['個人捐贈收入']    || 0, color:'#5b6af0'},
    {label:'營利事業', val: r1['營利事業捐贈收入'] || 0, color:'#f59e0b'},
    {label:'人民團體', val: r1['人民團體捐贈收入'] || 0, color:'#22c55e'},
    {label:'匿名捐贈', val: r1['匿名捐贈收入']    || 0, color:'#9ca3af'},
    {label:'其他',     val: r1['其他收入']         || 0, color:'#c084fc'},
  ].filter(function(x){ return x.val > 0; });

  var incBar = inc > 0 && incItems.length
    ? incItems.map(function(x) {
        var pct = (x.val/inc*100).toFixed(1);
        return '<div title="' + x.label + ': ' + pFmtAmtFull(x.val) + ' (' + pct + '%)" ' +
          'style="flex:' + (x.val/inc) + ';background:' + x.color +
          ';height:10px;min-width:2px;border-radius:3px;cursor:default"></div>';
      }).join('')
    : '<div style="color:var(--muted);font-size:.8rem">無收入資料</div>';

  var incLegend = incItems.map(function(x) {
    var pct = inc > 0 ? (x.val/inc*100).toFixed(1) : '0.0';
    return '<div style="display:flex;align-items:center;gap:5px;font-size:.75rem">' +
      '<div style="width:10px;height:10px;border-radius:3px;background:' + x.color + '"></div>' +
      '<span style="color:var(--sub)">' + x.label + '</span>' +
      '<span style="font-weight:600">' + pFmtAmtFull(x.val) + '</span>' +
      '<span style="color:var(--muted);font-size:.7rem">(' + pct + '%)</span></div>';
  }).join('');

  // 支出結構
  var expColors = ['#3b82f6','#f97316','#22c55e','#ef4444','#8b5cf6','#06b6d4','#ec4899','#78716c'];
  var expItems = [
    {label:'人事費用',        val: r1['人事費用支出']},
    {label:'業務費用',        val: r1['業務費用支出']},
    {label:'公共關係費用',    val: r1['公共關係費用支出']},
    {label:'選務費用',        val: r1['選務費用支出']},
    {label:'捐贈推薦候選人',  val: r1['捐贈其推薦之公職侯選人競選費用支出']},
    {label:'雜支',            val: r1['雜支支出']},
    {label:'返還捐贈',        val: r1['返還捐贈支出']},
    {label:'繳庫',            val: r1['繳庫支出']},
  ].filter(function(x){ return x.val && x.val > 0; })
   .map(function(x, i){ return {label:x.label, val:x.val, color:expColors[i % expColors.length]}; });

  var expBar = exp > 0 && expItems.length
    ? expItems.map(function(x) {
        var pct = (x.val/exp*100).toFixed(1);
        return '<div title="' + x.label + ': ' + pFmtAmtFull(x.val) + ' (' + pct + '%)" ' +
          'style="flex:' + (x.val/exp) + ';background:' + x.color +
          ';height:10px;min-width:2px;border-radius:3px;cursor:default"></div>';
      }).join('')
    : '<div style="color:var(--muted);font-size:.8rem">無支出資料</div>';

  var expLegend = expItems.map(function(x) {
    var pct = exp > 0 ? (x.val/exp*100).toFixed(1) : '0.0';
    return '<div style="display:flex;align-items:center;gap:5px;font-size:.75rem">' +
      '<div style="width:10px;height:10px;border-radius:3px;background:' + x.color + '"></div>' +
      '<span style="color:var(--sub)">' + x.label + '</span>' +
      '<span style="font-weight:600">' + pFmtAmtFull(x.val) + '</span>' +
      '<span style="color:var(--muted);font-size:.7rem">(' + pct + '%)</span></div>';
  }).join('');

  // Tab badge
  var corpN = (yrd.corp_items || []).length;
  var orgN  = (yrd.org_items  || []).length;
  var persN = (yrd.pers_items || []).length;
  function tabBadge(n) {
    return n ? ' <span style="background:var(--accent-lt);color:var(--accent);' +
      'border-radius:10px;padding:0 6px;font-size:.65rem;font-weight:700">' + n + '</span>' : '';
  }

  detEl.innerHTML =
    // Header
    '<div class="p-section" style="margin-bottom:16px">' +
      '<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px">' +
        '<div style="width:52px;height:52px;border-radius:14px;background:' + color.bg +
          ';color:' + color.text + ';display:flex;align-items:center;justify-content:center;' +
          'font-size:1.1rem;font-weight:700;flex-shrink:0">' + activeParty.slice(0,2) + '</div>' +
        '<div>' +
          '<div style="font-size:1.1rem;font-weight:700">' + activeParty + '</div>' +
          '<div style="font-size:.75rem;color:var(--sub);margin-top:2px">' +
            '申報日期：' + (r1['申報日期'] ? pFmtDate(r1['申報日期']) : '—') +
            '　結算日期：' + (r1['結算日期'] ? pFmtDate(r1['結算日期']) : '—') +
          '</div>' +
        '</div>' +
        '<div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' +
          yrBtns +
        '</div>' +
      '</div>' +
      '<div class="p-stat-grid">' +
        '<div class="p-stat"><div class="p-stat-label">收入合計</div>' +
          '<div class="p-stat-value p-blue">' + pFmtAmtFull(inc) + '</div></div>' +
        '<div class="p-stat"><div class="p-stat-label">支出合計</div>' +
          '<div class="p-stat-value">' + pFmtAmtFull(exp) + '</div></div>' +
        '<div class="p-stat"><div class="p-stat-label">本期結餘</div>' +
          '<div class="p-stat-value ' + balCls + '">' + balSign + pFmtAmtFull(bal) + '</div></div>' +
      '</div>' +
    '</div>' +
    // 收入結構
    '<div class="p-section">' +
      '<div class="p-section-title">收入結構</div>' +
      '<div style="display:flex;gap:3px;border-radius:5px;overflow:hidden;margin-bottom:12px;height:10px">' + incBar + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px 16px">' + incLegend + '</div>' +
    '</div>' +
    // 支出結構
    '<div class="p-section">' +
      '<div class="p-section-title">支出結構</div>' +
      '<div style="display:flex;gap:3px;border-radius:5px;overflow:hidden;margin-bottom:12px;height:10px">' + expBar + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px 16px">' + expLegend + '</div>' +
    '</div>' +
    // 主 Tab + 同場排名/捐款面板
    '<div class="p-section">' +
      '<div style="display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--border);padding-bottom:0;flex-wrap:wrap">' +
        '<button id="pmain-rank" class="donor-tab-btn' + (activePartyMainTab==='rank'?' active':'') +
          '" onclick="switchPartyMainTab(\'rank\')">同場排名</button>' +
        '<button id="pmain-donor" class="donor-tab-btn' + (activePartyMainTab==='donor'?' active':'') +
          '" onclick="switchPartyMainTab(\'donor\')">捐款明細</button>' +
      '</div>' +
      '<div id="party-rank-section" style="' + (activePartyMainTab==='rank'?'':'display:none') + '">' +
        '<div id="party-rank-container"></div>' +
      '</div>' +
      '<div id="party-donor-panel" style="' + (activePartyMainTab==='donor'?'':'display:none') + '">' +
        '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">' +
          '<button id="ptab-corp" class="donor-tab-btn' + (activePartyTab==='corp'?' active':'') +
            '" onclick="switchPartyTab(\'corp\')">營利事業' + tabBadge(corpN) + '</button>' +
          '<button id="ptab-org"  class="donor-tab-btn' + (activePartyTab==='org'?' active':'') +
            '" onclick="switchPartyTab(\'org\')">人民團體' + tabBadge(orgN) + '</button>' +
          '<button id="ptab-pers" class="donor-tab-btn' + (activePartyTab==='pers'?' active':'') +
            '" onclick="switchPartyTab(\'pers\')">個人 ≥ 10萬' + tabBadge(persN) + '</button>' +
        '</div>' +
        '<div class="p-section-title" id="party-donor-title" style="margin-bottom:10px"></div>' +
      '<div style="position:relative;margin-bottom:12px">' +
        '<span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:.82rem">&#128269;</span>' +
        '<input id="party-donor-search" type="text" placeholder="搜尋捐款人名稱或地區..." autocomplete="off" ' +
          'style="width:100%;background:var(--surface2);border:1.5px solid var(--border);color:var(--text);padding:8px 10px 8px 32px;border-radius:var(--radius-sm);font-size:.8rem;font-family:var(--sans);outline:none">' +
      '</div>' +
      '<div id="party-donor-count" style="font-size:.72rem;color:var(--muted);margin-bottom:8px"></div>' +
      '<div id="party-donor-list"></div>' +
    '</div>' +
      '</div>' +
    '</div>' +
      '</div>' +
    '</div>';

  // 綁定搜尋欄（固定在 DOM，只綁一次）
  var ds = document.getElementById('party-donor-search');
  if (ds) ds.addEventListener('input', function() {
    filterPartyDonor(this.value);
  });
  renderDonorSection();
  // 初始化同場排名
  if (typeof renderPartyRank === 'function') {
    _partyRankYr  = activePartyYr;
    _partyRankKey = 'income';
    setTimeout(renderPartyRank, 0);
  }
}

// 頁面載入後初始化年份按鈕（預設進入地方選舉頁）
window.addEventListener('DOMContentLoaded', function() {
  var btn = document.getElementById('mobile-yr-btn');
  if (btn) {
    btn.style.display = 'flex';
    var lbl = document.getElementById('mobile-yr-label');
    if (lbl) lbl.textContent = CURRENT_ELECTION || '2022';
  }
});

// ══ 整合捐款來源頁 ══════════════════════════════════════════════════
var _ud_query     = '';
var _ud_src       = 'all';   // all / 2022 / 2024 / party
var _ud_type      = 'all';   // all / corp / org
var _ud_sort      = 'total'; // total / nc / cross
var _ud_expanded  = new Set();
var _ud_page      = 0;
var _ud_pageSize  = 30;
var _ud_filtered  = [];

// ── 格式化 ──
function udAmt(n) {
  if (!n) return '—';
  if (n>=1e8) return (n/1e8).toFixed(1)+' 億';
  if (n>=1e4) return Math.round(n/1e4)+' 萬';
  return n.toLocaleString();
}
function udAmtFull(n) {
  return n ? '$ '+Math.round(n).toLocaleString() : '—';
}
function udDate(d) {
  if (!d) return '';
  var s = String(d).trim();
  // 7位民國數字：1121228 → 112/12/28
  if (/^\d{7}$/.test(s))
    return s.slice(0,3)+'/'+s.slice(3,5)+'/'+s.slice(5,7);
  // 民國NNN年MM月DD日 → NNN/MM/DD
  var m = s.match(/^(?:民國)?(\d{2,3})年(\d{1,2})月(\d{1,2})日$/);
  if (m) return m[1]+'/'+(m[2].padStart?m[2].padStart(2,'0'):m[2])+'/'+(m[3].padStart?m[3].padStart(2,'0'):m[3]);
  return s;
}

// ── 取得政黨顏色 ──
function udPartyColor(p) {
  if (typeof PARTY_COLORS_MAP !== 'undefined' && PARTY_COLORS_MAP[p])
    return PARTY_COLORS_MAP[p];
  if (typeof _PARTY_DATA !== 'undefined' && _PARTY_DATA[p])
    return _PARTY_DATA[p].color ? _PARTY_DATA[p].color.bg : '#9e9e9e';
  var MAP = {
    '民主進步黨':'#1b8c35','中國國民黨':'#1565c0','台灣民眾黨':'#28b4c8',
    '時代力量':'#ffd500','台灣基進':'#a00000','社會民主黨':'#d84f72',
    '親民黨':'#f97316','新黨':'#fbbf24','無黨籍':'#9ca3af',
  };
  return MAP[p] || '#9e9e9e';
}

// ── 建立政黨色條 ──
function udPartyBar(pd, total) {
  if (!pd || !pd.length) return '';
  var t = total || pd.reduce(function(s,x){ return s+x.a; }, 0);
  if (!t) return '';
  var bar = '<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;margin:8px 0 4px;gap:1px">' +
    pd.map(function(p) {
      return '<div title="' + p.p + ' ' + (p.a/t*100).toFixed(1) + '%"' +
        ' style="flex:' + p.a + ';background:' + udPartyColor(p.p) + ';min-width:2px"></div>';
    }).join('') + '</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:2px">' +
    pd.map(function(p) {
      return '<span style="font-size:.6rem;display:flex;align-items:center;gap:3px;color:var(--muted)">' +
        '<span class="ud-party-dot" style="background:' + udPartyColor(p.p) + '"></span>' +
        p.p + ' ' + (function(v){return v<1?v.toFixed(1):Math.round(v);})(p.a/t*100) + '%</span>';
    }).join('') + '</div>';
  return bar;
}

// ── 篩選並排序 ──
function udApplyFilter() {
  var q    = _ud_query.toLowerCase().trim();
  var src  = _ud_src;
  var type = _ud_type;

  _ud_filtered = _DONOR_UNIFIED.filter(function(item) {
    if (src !== 'all' && !item.sources[src]) return false;
    if (type === 'corp' && !item.is_corp) return false;
    if (type === 'org'  && !item.is_org)  return false;
    if (q && !item.name.toLowerCase().includes(q)) return false;
    return true;
  });

  _ud_filtered.sort(function(a, b) {
    if (_ud_sort === 'nc') return b.nc - a.nc;
    if (_ud_sort === 'cross') {
      const udCross = r => new Set(
        Object.values(r.sources).flatMap(s => (s.items||[]).map(it=>it.party||it.p||''))
          .filter(p => p)
      ).size;
      return udCross(b) - udCross(a);
    }
    if (src !== 'all') {
      return (b.sources[src]?b.sources[src].total:0) - (a.sources[src]?a.sources[src].total:0);
    }
    return b.total - a.total;
  });

  _ud_page = 0;
  _ud_expanded.clear();
  udRenderList();
  udUpdateMeta();
}

function udUpdateMeta() {
  var el = document.getElementById('ud-meta');
  if (el) el.textContent = '共 ' + _ud_filtered.length.toLocaleString() + ' 個' +
    (_ud_type==='corp'?'企業':_ud_type==='org'?'人民團體':'企業/團體');
}

// ── 渲染列表 ──
function udRenderList() {
  var listEl = document.getElementById('ud-list');
  if (!listEl) return;

  var start = _ud_page * _ud_pageSize;
  var items = _ud_filtered.slice(start, start + _ud_pageSize);
  var html  = '';

  items.forEach(function(item, idx) {
    var globalIdx = start + idx;
    var isExp     = _ud_expanded.has(globalIdx);
    var srcKeys   = Object.keys(item.sources);

    // 取當前篩選對應的 pd
    var pd = _ud_src === 'all'   ? item.pd_all   :
             _ud_src === '2022'  ? item.pd_2022  :
             _ud_src === '2024'  ? item.pd_2024  :
             _ud_src === '2018'  ? (item.pd_2018||[]) :
             _ud_src === '2020'  ? (item.pd_2020||[]) :
             _ud_src === 'party' ? item.pd_party : item.pd_all;
    var pdTotal = _ud_src === 'all' ? item.total :
                  (item.sources[_ud_src] ? item.sources[_ud_src].total : item.total);

    // 來源標籤
    var srcLabels = {'2022':'2022地方','2024':'2024總統','2018':'2018地方','2020':'2020總統','party':'政黨'};
    var srcColors = {
      '2022': {bg:'#eef0fd',color:'#5b6af0'},
      '2024': {bg:'#fef3c7',color:'#b45309'},
      '2018': {bg:'#fce7f3',color:'#9d174d'},
      '2020': {bg:'#fef9c3',color:'#854d0e'},
      'party':{bg:'#d1fae5',color:'#065f46'},
    };
    var srcTags = srcKeys.map(function(k) {
      var c = srcColors[k]||{bg:'#f3f4f6',color:'#6b7280'};
      return '<span style="font-size:.64rem;padding:1px 7px;border-radius:10px;' +
        'background:'+c.bg+';color:'+c.color+';font-weight:600;white-space:nowrap">' +
        (srcLabels[k]||k) + '</span>';
    }).join('');
    // 是否有任何非金錢捐款
    var has_inkind = false;
    srcKeys.forEach(function(sk) {
      if (!item.sources[sk]) return;
      item.sources[sk].items.forEach(function(it) {
        if (it.inkind) has_inkind = true;
      });
    });
    if (!item.has_inkind) item.has_inkind = has_inkind;

    var typeTag = item.is_org && !item.is_corp
      ? '<span style="font-size:.62rem;padding:1px 6px;border-radius:10px;background:#ede9fe;color:#6d28d9;font-weight:600">團體</span>'
      : '';

    // 顯示金額（依篩選）
    var dispAmt = _ud_src === 'all' ? item.total
                : (item.sources && item.sources[_ud_src] ? item.sources[_ud_src].total : 0);

    // 展開內容
    var detail = '';
    if (isExp) {
      detail = '<div style="padding:10px 0 4px;border-top:1px solid var(--border);margin-top:8px">';

      var showSrcs = _ud_src === 'all' ? ['2024','2022','2020','2018','party'] : [_ud_src];
      showSrcs.forEach(function(sk) {
        if (!item.sources[sk]) return;
        var sitems = item.sources[sk].items;
        var sLabel = {'2022':'2022地方選舉','2024':'2024總統立委','2018':'2018地方選舉','2020':'2020總統立委','party':'政黨'}[sk]||sk;
        var sc = srcColors[sk]||{color:'#333',bg:'#f0f0f0'};

        detail += '<div style="margin-bottom:12px">';
        detail += '<div style="font-size:.68rem;font-weight:700;color:'+sc.color+';' +
          'background:'+sc.bg+';padding:3px 10px;border-radius:10px;display:inline-block;margin-bottom:8px">' +
          sLabel + '（' + sitems.length + ' 筆，合計 ' + udAmtFull(item.sources[sk].total) + '）</div>';

        if (sk === 'party') {
          // 政黨：依年份分組
          var byYr = {};
          sitems.forEach(function(it) {
            var yr = it.yr||'?';
            if (!byYr[yr]) byYr[yr] = [];
            byYr[yr].push(it);
          });
          Object.keys(byYr).sort(function(a,b){return b-a;}).forEach(function(yr) {
            var yrLabel = {107:'2018年',108:'2019年',109:'2020年',110:'2021年',111:'2022年',112:'2023年',113:'2024年'}[parseInt(yr)]||(yr+'年');
            detail += '<div style="font-size:.7rem;color:var(--muted);margin:4px 0 3px;font-weight:600">'+yrLabel+'</div>';
            byYr[yr].forEach(function(it) {
              var pc = udPartyColor(it.party);
              var partyRet = it.ret && it.ret !== 'nan' && it.ret !== ''
                ? '<span style="font-size:.62rem;color:var(--red);margin-left:4px">['+it.ret+']</span>' : '';
              detail += '<div style="display:flex;align-items:center;padding:5px 0;' +
                'border-bottom:1px solid var(--border);gap:8px;font-size:.8rem">' +
                '<span class="ud-party-dot" style="background:'+pc+'"></span>' +
                '<div style="flex:1">'+it.party+partyRet+'</div>' +
                '<div style="color:var(--muted);font-size:.7rem;white-space:nowrap">'+udDate(it.date)+'</div>' +
                '<div style="font-family:var(--mono);font-weight:600;color:var(--accent);white-space:nowrap">'+udAmtFull(it.amt)+'</div>' +
                '</div>';
            });
          });
        } else {
          // 候選人
          sitems.forEach(function(it) {
            var pc = udPartyColor(it.party);
            var ret = it.ret && it.ret !== 'nan' && it.ret !== ''
              ? '<span style="font-size:.62rem;color:var(--red);margin-left:4px">['+it.ret+']</span>' : '';
            var inkind = it.inkind ? '<span style="font-size:.62rem;padding:1px 5px;border-radius:8px;background:#f3e8ff;color:#7c3aed;border:1px solid #c4b5fd;margin-left:5px;font-weight:600">非金錢</span>' : '';
            detail += '<div style="display:flex;align-items:center;padding:5px 0;' +
              'border-bottom:1px solid var(--border);gap:8px;font-size:.8rem">' +
              '<span class="ud-party-dot" style="background:'+pc+'"></span>' +
              '<div style="flex:1;min-width:0">' +
                '<span style="font-weight:600">'+it.cand+'</span>' +
                (it.city?'<span style="color:var(--muted);font-size:.7rem;margin-left:4px">'+it.city+'</span>':'') +
                (it.party?'<span style="font-size:.65rem;color:'+pc+';margin-left:5px;font-weight:600">'+it.party+'</span>':'') +
                ret + (it.inkind?'<span style="font-size:.62rem;padding:1px 5px;border-radius:8px;background:#f3e8ff;color:#7c3aed;border:1px solid #c4b5fd;margin-left:4px;font-weight:600">非金錢</span>':'') +
              '</div>' +
              '<div style="color:var(--muted);font-size:.7rem;white-space:nowrap">'+it.date+'</div>' +
              '<div style="font-family:var(--mono);font-weight:600;color:var(--accent);white-space:nowrap">'+udAmtFull(it.amt)+'</div>' +
              '</div>';
          });
        }
        detail += '</div>';
      });
      detail += '</div>';
    }

    html += '<div class="ud-item-card">' +
      '<div style="display:flex;align-items:center;gap:10px;cursor:pointer" onclick="udToggle('+globalIdx+')">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+item.name+'</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;align-items:center">'+
            '<span style="font-size:.68rem;color:var(--muted)">· '+item.nc+' 位受捐人/政黨</span>' +
          '</div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0">' +
          '<div style="font-size:.95rem;font-weight:700;font-family:var(--mono);color:var(--accent)">'+udAmt(dispAmt)+'</div>' +
          '<div style="font-size:.68rem;color:var(--muted)">'+(_ud_src==='all'?'總計':({'2022':'2022地方','2024':'2024總統','2018':'2018地方','2020':'2020總統','party':'政黨'}[_ud_src]||''))+'</div>' +
        '</div>' +
        '<div style="color:var(--muted);font-size:.8rem;flex-shrink:0">'+(isExp?'▲':'▼')+'</div>' +
      '</div>' +
      // 長條圖（收合時也顯示）
      udPartyBar(pd, pdTotal) +
      detail +
    '</div>';
  });

  var hasMore = (_ud_page+1)*_ud_pageSize < _ud_filtered.length;
  if (hasMore) {
    html += '<div style="text-align:center;padding:12px 12px 80px;display:flex;justify-content:center;gap:8px">' +
      '<button onclick="udLoadMore()" style="font-size:.78rem;padding:8px 24px;border-radius:8px;' +
        'border:1.5px solid var(--border);background:var(--surface);color:var(--accent);' +
        'cursor:pointer;font-weight:600">' +
        '載入更多（'+Math.min((_ud_page+1)*_ud_pageSize,_ud_filtered.length)+' / '+_ud_filtered.length+'）' +
      '</button>' +
      (_ud_page > 0 ? '<button onclick="udPrevPage()" style="font-size:.78rem;padding:8px 24px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer;font-weight:600">上一頁</button>' : '') +
    '</div>';
  }

  listEl.innerHTML = html;
}

function udToggle(idx) {
  if (_ud_expanded.has(idx)) { _ud_expanded.delete(idx); }
  else { _ud_expanded.clear(); _ud_expanded.add(idx); }
  udRenderList();
}
function udPrevPage() {
  if (_ud_page <= 0) return;
  _ud_page--;
  udRenderList();
  setTimeout(function() {
    var listEl = document.getElementById('ud-list');
    if (!listEl) return;
    var barH = document.getElementById('ud-mobile-filter-bar');
    var barHeight = barH ? barH.offsetHeight + 8 : 8;
    listEl.style.scrollMarginTop = barHeight + 'px';
    listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

function _findScrollContainer(el) {
  var p = el ? el.parentElement : null;
  while (p) {
    var ov = getComputedStyle(p).overflowY;
    if (ov === 'auto' || ov === 'scroll') return p;
    p = p.parentElement;
  }
  return null;
}

function udLoadMore() {
  _ud_page++;
  udRenderList();
  setTimeout(function() {
    var listEl = document.getElementById('ud-list');
    if (!listEl) return;
    var barH = document.getElementById('ud-mobile-filter-bar');
    var barHeight = barH ? barH.offsetHeight + 8 : 8;
    listEl.style.scrollMarginTop = barHeight + 'px';
    listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

// ── 初始化 ──
function initUnifiedDonorPage() {
  var el = document.getElementById('page-donor');
  if (el.dataset.udInit) return;
  el.dataset.udInit = '1';

  el.innerHTML =
    '<div style="display:flex;width:100%;height:100%;overflow:hidden;flex-direction:var(--donor-dir,row)">' +
    // 左側 sidebar
    '<div id="ud-filter-panel" style="width:200px;flex-shrink:0;border-right:1px solid var(--border);' +
         'padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:12px;background:var(--surface)">' +
      // 手機版折疊按鈕
      '<div id="ud-filter-toggle" onclick="(function(el){' +
          'el.classList.toggle(\'collapsed\');' +
          'var a=document.getElementById(\'ud-arr\');' +
          'if(a)a.style.transform=el.classList.contains(\'collapsed\')?\'rotate(-90deg)\':\'\';})(this.parentElement)"' +
        ' style="display:none;align-items:center;justify-content:space-between;cursor:pointer;' +
                'padding:6px 0;font-size:.78rem;font-weight:700;color:var(--text)">' +
        '<span>篩選條件</span>' +
        '<span id="ud-arr" style="transition:transform .2s;font-size:.7rem;color:var(--muted)">▼</span>' +
      '</div>' +
      // 搜尋欄
      '<div>' +
        '<div style="font-size:.68rem;font-weight:700;color:var(--muted);letter-spacing:.08em;' +
                    'text-transform:uppercase;margin-bottom:6px">搜尋</div>' +
        '<div style="position:relative">' +
          '<span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);' +
                       'color:var(--muted);font-size:.78rem">&#128269;</span>' +
          '<input id="ud-search" type="text" placeholder="企業或團體名稱..." autocomplete="off"' +
            ' style="width:100%;background:var(--surface2);border:1.5px solid var(--border);' +
                    'color:var(--text);padding:7px 8px 7px 28px;border-radius:var(--radius-sm);' +
                    'font-size:.76rem;font-family:var(--sans);outline:none;box-sizing:border-box">' +
        '</div>' +
      '</div>' +
      // 來源篩選
      '<div>' +
        '<div style="font-size:.68rem;font-weight:700;color:var(--muted);letter-spacing:.08em;' +
                    'text-transform:uppercase;margin-bottom:6px">來源</div>' +
        '<select id="ud-src-select" class="ud-select" onchange="udSetSrc(this.value)">' +
          '<option value="all">全部來源</option>' +
          '<option value="2024">2024 總統立委</option>' +
          '<option value="2022">2022 地方選舉</option>' +
          '<option value="2020">2020 總統立委</option>' +
          '<option value="2018">2018 地方選舉</option>' +
          '<option value="party">政黨</option>' +
        '</select>' +
      '</div>' +
      // 類型篩選
      '<div>' +
        '<div style="font-size:.68rem;font-weight:700;color:var(--muted);letter-spacing:.08em;' +
                    'text-transform:uppercase;margin-bottom:6px">類型</div>' +
        '<select id="ud-type-select" class="ud-select" onchange="udSetType(this.value)">' +
          '<option value="all">全部</option>' +
          '<option value="corp">營利事業</option>' +
          '<option value="org">人民團體</option>' +
        '</select>' +
      '</div>' +
      // 排序
      '<div>' +
        '<div style="font-size:.68rem;font-weight:700;color:var(--muted);letter-spacing:.08em;' +
                    'text-transform:uppercase;margin-bottom:6px">排序</div>' +
        '<select id="ud-sort-select" class="ud-select" onchange="udSetSort(this.value)">' +
          '<option value="total">捐款總額</option>' +
          '<option value="nc">受捐人數</option>' +
          '<option value="cross">跨黨程度</option>' +
        '</select>' +
      '</div>' +
    '</div>' +
    // 右側列表
    '<div style="flex:1;overflow-y:auto;padding:16px 20px;background:var(--bg)">' +
      '<div id="ud-meta" style="font-size:.72rem;color:var(--muted);margin-bottom:12px"></div>' +
      '<div id="ud-list"></div>' +
    '</div>' +
    '</div>';

  // 綁定搜尋欄
  document.getElementById('ud-search').addEventListener('input', function() {
    _ud_query = this.value;
    udApplyFilter();
  });

  // 手機版：隱藏左側 sidebar，頂部顯示搜尋列 + 篩選按鈕
  if (window.innerWidth <= 900) {
    var fp = document.getElementById('ud-filter-panel');
    if (fp) fp.style.display = 'none';
    udShowMobileFilterBar();
  }

  if (window._DONOR_UNIFIED) udApplyFilter();
}

function udSetSrc(v)  { _ud_src  = v; udApplyFilter(); }
function udSetType(v) { _ud_type = v; udApplyFilter(); }
function udSetSort(v) { _ud_sort = v; udApplyFilter(); }


// ── 手機版捐款來源篩選 ──
function udMobileSearch(val) {
  if (typeof _donorTab !== 'undefined' && _donorTab === 'pers') {
    if (typeof _pd_query !== 'undefined') _pd_query = val;
    if (typeof pdApplyFilter === 'function') pdApplyFilter();
  } else {
    if (typeof _ud_query !== 'undefined') _ud_query = val;
    if (typeof udApplyFilter === 'function') udApplyFilter();
  }
}

function udShowMobileFilterBar() {
  // bar 已是靜態 HTML，只需更新 label
  var label = document.getElementById('ud-mobile-type-label');
  if (label) label.textContent = (typeof _donorTab !== 'undefined' && _donorTab === 'pers') ? '個人' : '企業/團體';
  return;
  // 以下舊邏輯不再執行
  var pageEl = document.getElementById('page-donor-corp') ||
               document.getElementById('page-donor');
  if (!pageEl || document.getElementById('ud-mobile-filter-bar')) return;

  var bar = document.createElement('div');
  bar.id = 'ud-mobile-filter-bar';
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;' +
    'padding:10px 12px;border-bottom:1px solid var(--border);' +
    'background:var(--surface);flex-shrink:0';

  var _donorTypeLabel = (typeof _donorTab !== 'undefined' && _donorTab === 'pers') ? '個人' : '企業/團體';
  bar.innerHTML =
    '<div style="position:relative;flex:1;min-width:0">' +
      '<span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);' +
             'color:var(--muted);font-size:.82rem">&#128269;</span>' +
      '<input id="ud-mobile-search" type="text" placeholder="搜尋捐款來源..." autocomplete="off"' +
        ' style="width:100%;background:var(--surface2);border:1.5px solid var(--border);' +
               'color:var(--text);padding:7px 8px 7px 28px;border-radius:var(--radius-sm);' +
               'font-size:.83rem;font-family:var(--sans);outline:none;box-sizing:border-box">' +
    '</div>' +
    '<button id="ud-mobile-filter-btn" onclick="udOpenDonorSheet()"' +
      ' style="display:flex;align-items:center;gap:4px;padding:7px 10px;' +
             'border-radius:10px;border:1.5px solid var(--border);' +
             'background:var(--surface);color:var(--text);cursor:pointer;' +
             'font-size:.75rem;font-family:var(--sans);font-weight:600;white-space:nowrap;flex-shrink:0">' +
      '⚙ 篩選' +
    '</button>' +
    '<button id="ud-mobile-type-btn" onclick="openDonorTypeSheet()"' +
      ' style="display:flex;align-items:center;gap:4px;padding:7px 10px;' +
             'border-radius:10px;border:1.5px solid var(--border);' +
             'background:var(--surface);color:var(--text);cursor:pointer;' +
             'font-size:.75rem;font-family:var(--sans);font-weight:600;white-space:nowrap;flex-shrink:0">' +
      '👤 <span id="ud-mobile-type-label">' + _donorTypeLabel + '</span>' +
    '</button>';

  // 插到 page-donor 的最頂部（不放在 page-donor-corp 裡，避免切換個人頁時消失）
  var pageDonor = document.getElementById('page-donor');
  if (pageDonor) {
    pageDonor.style.flexDirection = 'column';
    pageDonor.insertBefore(bar, pageDonor.firstChild);
  }

  // 綁定手機版搜尋欄
  setTimeout(function() {
    var msi = document.getElementById('ud-mobile-search');
    if (msi) msi.addEventListener('input', function() {
      _ud_query = this.value;
      // 同步桌面版搜尋欄（若存在）
      var dsi = document.getElementById('ud-search');
      if (dsi) dsi.value = this.value;
      udApplyFilter();
    });
  }, 0);
}

function udUpdateActiveTags() { return; // 已由 udUpdateFilterBtnState 取代

  var el = document.getElementById('ud-active-tags');
  if (!el) return;
  var tags = [];
  var srcLabel = {'2022':'2022地方','2024':'2024總統','2018':'2018地方','2020':'2020總統','party':'政黨'};
  var typeLabel = {'corp':'營利事業','org':'人民團體'};
  if (_ud_src  !== 'all') tags.push(srcLabel[_ud_src] || _ud_src);
  if (_ud_type !== 'all') tags.push(typeLabel[_ud_type] || _ud_type);
  el.innerHTML = tags.map(function(t) {
    return '<span style="font-size:.65rem;padding:2px 8px;border-radius:10px;' +
      'background:var(--accent-lt);color:var(--accent);font-weight:600">' + t + '</span>';
  }).join('');
}

function udOpenDonorSheet() {
  // 更新 donor-sheet 的內容為整合版篩選
  var body = document.getElementById('donor-sheet-body');
  if (!body) return;
  body.innerHTML =
    '<div style="margin-bottom:16px">' +
      '<label style="font-size:.78rem;font-weight:600;color:var(--muted);display:block;margin-bottom:6px">來源</label>' +
      '<select id="ud-sheet-src" class="ud-select" style="font-size:.82rem">' +
        '<option value="all">全部來源</option>' +
        '<option value="2024">2024 總統立委</option>' +
        '<option value="2022">2022 地方選舉</option>' +
        '<option value="2020">2020 總統立委</option>' +
        '<option value="2018">2018 地方選舉</option>' +
        '<option value="party">政黨</option>' +
      '</select>' +
    '</div>' +
    '<div style="margin-bottom:16px">' +
      '<label style="font-size:.78rem;font-weight:600;color:var(--muted);display:block;margin-bottom:6px">類型</label>' +
      '<select id="ud-sheet-type" class="ud-select" style="font-size:.82rem">' +
        '<option value="all">全部</option>' +
        '<option value="corp">營利事業</option>' +
        '<option value="org">人民團體</option>' +
      '</select>' +
    '</div>' +
    '<div style="margin-bottom:16px">' +
      '<label style="font-size:.78rem;font-weight:600;color:var(--muted);display:block;margin-bottom:6px">排序</label>' +
      '<select id="ud-sheet-sort" class="ud-select" style="font-size:.82rem">' +
        '<option value="total">捐款總額</option>' +
        '<option value="nc">受捐人數</option>' +
        '<option value="cross">跨黨程度</option>' +
      '</select>' +
    '</div>';

  // 設定目前值
  document.getElementById('ud-sheet-src').value  = _ud_src;
  document.getElementById('ud-sheet-type').value = _ud_type;
  document.getElementById('ud-sheet-sort').value = _ud_sort;

  // 更新 footer 按鈕
  var footer = document.getElementById('donor-sheet-footer');
  if (footer) {
    footer.innerHTML =
      '<button id="filter-reset-btn" onclick="udResetSheet()" ' +
        'style="flex:1;padding:12px;border-radius:8px;border:1.5px solid var(--border);' +
               'background:var(--surface);color:var(--text);font-size:.82rem;' +
               'font-weight:600;cursor:pointer;font-family:var(--sans)">清除篩選</button>' +
      '<button id="filter-apply-btn" onclick="udApplyDonorSheet();closeDonorSheet()" ' +
        'style="flex:1;padding:12px;border-radius:8px;border:none;background:var(--accent);' +
               'color:#fff;font-size:.82rem;font-weight:600;cursor:pointer;font-family:var(--sans)">套用篩選</button>';
  }

  // 開啟 sheet（重用 donor-sheet 的動畫）
  var overlay = document.getElementById('donor-sheet-overlay');
  var sheet   = document.getElementById('donor-sheet');
  if (!overlay || !sheet) return;
  overlay.style.display = 'block';
  requestAnimationFrame(function() { requestAnimationFrame(function() {
    overlay.classList.add('visible');
    sheet.classList.add('open');
  }); });
  document.body.style.overflow = 'hidden';
}

function udApplyDonorSheet() {
  var src  = document.getElementById('ud-sheet-src');
  var type = document.getElementById('ud-sheet-type');
  var sort = document.getElementById('ud-sheet-sort');
  if (src)  { _ud_src  = src.value;  var dsSrc  = document.getElementById('ud-src-select');  if(dsSrc)  dsSrc.value  = src.value; }
  if (type) { _ud_type = type.value; var dsType = document.getElementById('ud-type-select'); if(dsType) dsType.value = type.value; }
  if (sort) { _ud_sort = sort.value; var dsSort = document.getElementById('ud-sort-select'); if(dsSort) dsSort.value = sort.value; }
  if (window._DONOR_UNIFIED) udApplyFilter();
  udUpdateFilterBtnState();
}

function udResetSheet() {
  _ud_src = 'all'; _ud_type = 'all'; _ud_sort = 'total';
  _ud_query = '';
  var msi = document.getElementById('ud-mobile-search');
  if (msi) msi.value = '';
  var dsi = document.getElementById('ud-search');
  if (dsi) dsi.value = '';
  if (window._DONOR_UNIFIED) udApplyFilter();
  udUpdateFilterBtnState();
  closeDonorSheet();
}

function udUpdateFilterBtnState() {
  var btn = document.getElementById('ud-mobile-filter-btn');
  if (!btn) return;
  var hasFilter = _ud_src !== 'all' || _ud_type !== 'all';
  btn.style.borderColor = hasFilter ? 'var(--accent)' : 'var(--border)';
  btn.style.color       = hasFilter ? 'var(--accent)' : 'var(--text)';
  btn.style.background  = hasFilter ? 'var(--accent-lt)' : 'var(--surface)';
}


function partyGoBack() {
  var pm = document.getElementById('party-main');
  if (pm) {
    pm.classList.remove('mobile-visible');
    setTimeout(function() { pm.scrollTop = 0; }, 300);
  }
  var backBtn = document.getElementById('party-back-btn');
  if (backBtn) backBtn.style.display = 'none';
}

// 覆蓋 initDonorPage
initDonorPage = function() { initUnifiedDonorPage(); };

// ══ 捐款來源子選項切換 ══════════════════════════════════════════════
var _donorTab = 'corp';  // corp / pers

function switchDonorTab(tab) {
  // 切換時全部收合並立即滾回頂部
  if (window._ud_expanded) _ud_expanded.clear();
  if (window._pd_expanded) _pd_expanded.clear();
  if (window._ud_page !== undefined) _ud_page = 0;
  if (window._pd_page !== undefined) _pd_page = 0;
  // 清空篩選和搜尋（呼叫完整重設函式，資料未載入時跳過）
  if (typeof udResetSheet === 'function' && window._DONOR_UNIFIED) udResetSheet();
  if (typeof pdResetSheet === 'function' && window._PERSONAL_UNIFIED) pdResetSheet();
  // 清空搜尋欄 DOM
  ['ud-search','pd-search','ud-mobile-search','pd-mobile-search'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  // 立即滾回頂部（不用 setTimeout）
  var donorEl = document.getElementById('page-donor');
  if (donorEl) donorEl.scrollTop = 0;
  _donorTab = tab;

  // 更新手機版類型按鈕 label（靜態 bar）
  var typeLabel = document.getElementById('ud-mobile-type-label');
  if (typeLabel) typeLabel.textContent = tab === 'pers' ? '個人' : '企業/團體';
  // 篩選按鈕：依 tab 切換 onclick 和顯示
  var filterBtn = document.getElementById('ud-mobile-filter-btn');
  if (filterBtn) {
    filterBtn.style.display = '';  // 永遠顯示
    filterBtn.onclick = tab === 'pers'
      ? function(){ if(typeof pdOpenDonorSheet==='function') pdOpenDonorSheet(); }
      : function(){ if(typeof udOpenDonorSheet==='function') udOpenDonorSheet(); };
  }
  // 更新搜尋欄 placeholder 並清空
  var mSearch = document.getElementById('ud-mobile-search');
  if (mSearch) {
    mSearch.placeholder = tab === 'pers' ? '搜尋姓名或地區…' : '搜尋捐款來源…';
    mSearch.value = '';
  }

  // 切換頁面
  var corpPage = document.getElementById('page-donor-corp');
  var persPage = document.getElementById('page-donor-pers');

  if (!corpPage || !persPage) {
    // 尚未建立子頁面，先建立
    buildDonorSubPages();
    corpPage = document.getElementById('page-donor-corp');
    persPage = document.getElementById('page-donor-pers');
  }

  // 確保 page-donor 是 flex 容器
  var pageEl = document.getElementById('page-donor');
  if (pageEl) { pageEl.style.display = 'flex'; pageEl.style.flexDirection = 'column'; }
  if (corpPage) corpPage.style.cssText = 'display:' + (tab === 'corp' ? 'flex' : 'none') + ';width:100%;flex:1;overflow:hidden;flex-direction:row';
  if (persPage) persPage.style.cssText = 'display:' + (tab === 'pers' ? 'flex' : 'none') + ';width:100%;flex:1;overflow:hidden;flex-direction:row';

  if (tab === 'corp') {
    if (!corpPage.dataset.udInit) {
      initUnifiedDonorPage();
    } else {
      // 已初始化：強制重新渲染以反映收合狀態
      if (typeof udRenderList === 'function') udRenderList();
    }
  }
  if (tab === 'pers') {
    if (!persPage.dataset.pdInit) {
      initPersonalDonorPage();
    } else {
      if (typeof pdRenderList === 'function') pdRenderList();
    }
  }
  // 切換後彈回頂部
  setTimeout(function() {
    var el = tab === 'corp'
      ? (document.getElementById('ud-list') || corpPage)
      : (document.getElementById('pd-list') || persPage);
    if (el) el.scrollTop = 0;
    var wrap = document.getElementById('page-donor-corp') || document.getElementById('page-donor');
    if (wrap) wrap.scrollTop = 0;
  }, 50);
}

function buildDonorSubPages() {
  var pageEl = document.getElementById('page-donor');
  if (!pageEl) return;

  // 建立企業/團體子頁
  var corpDiv = document.createElement('div');
  corpDiv.id = 'page-donor-corp';
  corpDiv.style.cssText = 'display:flex;width:100%;flex:1;overflow:hidden;flex-direction:var(--donor-dir,row)';

  // 建立個人子頁
  var persDiv = document.createElement('div');
  persDiv.id = 'page-donor-pers';
  persDiv.style.cssText = 'display:none;width:100%;flex:1;overflow:hidden;flex-direction:var(--donor-dir,row)';

  pageEl.innerHTML = '';
  pageEl.appendChild(corpDiv);
  pageEl.appendChild(persDiv);
}

// 覆蓋 initDonorPage：改成初始化子頁面架構
initDonorPage = function() {
  var pageEl = document.getElementById('page-donor');
  if (!pageEl) return;
  pageEl.style.display = 'flex';
  if (!pageEl.dataset.tabInit) {
    pageEl.dataset.tabInit = '1';
    buildDonorSubPages();
  }
  switchDonorTab(_donorTab);
};

// 覆蓋 initUnifiedDonorPage：改成在 page-donor-corp 裡建立
var _origInitUnified = initUnifiedDonorPage;
initUnifiedDonorPage = function() {
  var target = document.getElementById('page-donor-corp') ||
               document.getElementById('page-donor');
  if (!target) return;
  if (target.dataset.udInit) return;
  target.dataset.udInit = '1';

  target.innerHTML =
    '<div style="display:flex;width:100%;height:100%;overflow:hidden;flex-direction:var(--donor-dir,row)">' +
    // 左側 sidebar
    '<div id="ud-filter-panel" style="width:200px;flex-shrink:0;border-right:1px solid var(--border);' +
         'padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:12px;background:var(--surface)">' +
      '<div id="ud-filter-toggle" onclick="(function(el){' +
          'el.classList.toggle(\'collapsed\');' +
          'var a=document.getElementById(\'ud-arr\');' +
          'if(a)a.style.transform=el.classList.contains(\'collapsed\')?\'rotate(-90deg)\':\'\';})(this.parentElement)"' +
        ' style="display:none;align-items:center;justify-content:space-between;cursor:pointer;' +
                'padding:6px 0;font-size:.78rem;font-weight:700;color:var(--text)">' +
        '<span>篩選條件</span>' +
        '<span id="ud-arr" style="transition:transform .2s;font-size:.7rem;color:var(--muted)">▼</span>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:.68rem;font-weight:700;color:var(--muted);letter-spacing:.08em;' +
                    'text-transform:uppercase;margin-bottom:6px">搜尋</div>' +
        '<div style="position:relative">' +
          '<span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);' +
                       'color:var(--muted);font-size:.78rem">&#128269;</span>' +
          '<input id="ud-search" type="text" placeholder="企業或團體名稱..." autocomplete="off"' +
            ' style="width:100%;background:var(--surface2);border:1.5px solid var(--border);' +
                    'color:var(--text);padding:7px 8px 7px 28px;border-radius:var(--radius-sm);' +
                    'font-size:.76rem;font-family:var(--sans);outline:none;box-sizing:border-box">' +
        '</div>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:.68rem;font-weight:700;color:var(--muted);letter-spacing:.08em;' +
                    'text-transform:uppercase;margin-bottom:6px">來源</div>' +
        '<select id="ud-src-select" class="ud-select" onchange="udSetSrc(this.value)">' +
          '<option value="all">全部來源</option>' +
          '<option value="2024">2024 總統立委</option>' +
          '<option value="2022">2022 地方選舉</option>' +
          '<option value="2020">2020 總統立委</option>' +
          '<option value="2018">2018 地方選舉</option>' +
          '<option value="party">政黨</option>' +
        '</select>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:.68rem;font-weight:700;color:var(--muted);letter-spacing:.08em;' +
                    'text-transform:uppercase;margin-bottom:6px">類型</div>' +
        '<select id="ud-type-select" class="ud-select" onchange="udSetType(this.value)">' +
          '<option value="all">全部</option>' +
          '<option value="corp">營利事業</option>' +
          '<option value="org">人民團體</option>' +
        '</select>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:.68rem;font-weight:700;color:var(--muted);letter-spacing:.08em;' +
                    'text-transform:uppercase;margin-bottom:6px">排序</div>' +
        '<select id="ud-sort-select" class="ud-select" onchange="udSetSort(this.value)">' +
          '<option value="total">捐款總額</option>' +
          '<option value="nc">受捐人數</option>' +
          '<option value="cross">跨黨程度</option>' +
        '</select>' +
      '</div>' +
    '</div>' +
    '<div style="flex:1;overflow-y:auto;padding:16px 20px;background:var(--bg)">' +
      '<div id="ud-meta" style="font-size:.72rem;color:var(--muted);margin-bottom:12px"></div>' +
      '<div id="ud-list"></div>' +
    '</div>' +
    '</div>';

  document.getElementById('ud-search').addEventListener('input', function() {
    _ud_query = this.value; udApplyFilter();
  });

  if (window.innerWidth <= 900) {
    var fp2 = document.getElementById('ud-filter-panel');
    if (fp2) fp2.style.display = 'none';
    udShowMobileFilterBar();
  }
  if (window._DONOR_UNIFIED) udApplyFilter();
};

// ══ 個人捐款頁 ════════════════════════════════════════════════════════
var _pd_query  = '';
var _pd_src    = 'all';   // all / 2022 / 2024 / party
var _pd_nc     = 'all';   // all / 1 / 2 / 5
var _pd_sort   = 'total'; // total / nc / max
var _pd_page   = 0;
var _pd_size   = 30;
var _pd_filtered = [];
var _pd_expanded = new Set();

function pdAmt(n) {
  if (!n) return '—';
  if (n>=1e8) return (n/1e8).toFixed(1)+' 億';
  if (n>=1e4) return Math.round(n/1e4)+' 萬';
  return n.toLocaleString();
}
function pdAmtFull(n) { return n ? '$ '+Math.round(n).toLocaleString() : '—'; }
function pdDate(d) {
  if (!d) return '';
  var s = String(d).trim();
  // 7位民國數字：1121228 → 112/12/28
  if (/^\d{7}$/.test(s))
    return s.slice(0,3)+'/'+s.slice(3,5)+'/'+s.slice(5,7);
  // 民國NNN年MM月DD日 → NNN/MM/DD
  var m = s.match(/^(?:民國)?(\d{2,3})年(\d{1,2})月(\d{1,2})日$/);
  if (m) return m[1]+'/'+(m[2].padStart?m[2].padStart(2,'0'):m[2])+'/'+(m[3].padStart?m[3].padStart(2,'0'):m[3]);
  return s;
}
function pdPartyColor(p) {
  if (typeof PARTY_COLORS_MAP !== 'undefined' && PARTY_COLORS_MAP[p]) return PARTY_COLORS_MAP[p];
  var MAP = {'民主進步黨':'#1b8c35','中國國民黨':'#1565c0','台灣民眾黨':'#28b4c8',
             '時代力量':'#ffd500','台灣基進':'#a00000','社會民主黨':'#d84f72',
             '親民黨':'#f97316','無黨籍':'#9ca3af'};
  return MAP[p] || '#9e9e9e';
}

function pdPartyBar(pd, total) {
  if (!pd || !pd.length) return '';
  var t = total || pd.reduce(function(s,x){return s+x.a;},0);
  if (!t) return '';
  return '<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;margin:8px 0 4px;gap:1px">' +
    pd.map(function(p) {
      return '<div title="'+p.p+' '+(p.a/t*100).toFixed(1)+'%"' +
        ' style="flex:'+p.a+';background:'+pdPartyColor(p.p)+';min-width:2px"></div>';
    }).join('') + '</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:2px">' +
    pd.map(function(p) {
      return '<span style="font-size:.6rem;display:flex;align-items:center;gap:3px;color:var(--muted)">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:'+pdPartyColor(p.p)+
        ';display:inline-block;flex-shrink:0"></span>' +
        p.p+' '+(function(v){return v<1?v.toFixed(1):Math.round(v);})(p.a/t*100)+'%</span>';
    }).join('') + '</div>';
}

function pdApplyFilter() {
  var q   = _pd_query.toLowerCase().trim();
  var src = _pd_src;
  var nc  = _pd_nc;

  _pd_filtered = _PERSONAL_UNIFIED.filter(function(item) {
    if (src !== 'all' && !item.sources[src]) return false;
    if (nc === '1' && item.nc !== 1) return false;
    if (nc === '2' && item.nc < 2)  return false;
    if (nc === '5' && item.nc < 5)  return false;
    if (q && !item.name.toLowerCase().includes(q) &&
        !(item.addr||'').toLowerCase().includes(q)) return false;
    return true;
  });

  _pd_filtered.sort(function(a,b) {
    if (_pd_sort === 'nc') return b.nc - a.nc;
    if (_pd_sort === 'cross') return Object.keys(b.sources).length - Object.keys(a.sources).length;
    if (src !== 'all') {
      return (b.sources[src]?b.sources[src].total:0) -
             (a.sources[src]?a.sources[src].total:0);
    }
    return b.total - a.total;
  });

  _pd_page = 0;
  _pd_expanded.clear();
  pdRenderList();
  pdUpdateMeta();
}

function pdUpdateMeta() {
  var el = document.getElementById('pd-meta');
  if (el) el.textContent = '共 '+_pd_filtered.length.toLocaleString()+' 位個人捐款者';
}

function pdRenderList() {
  var listEl = document.getElementById('pd-list');
  if (!listEl) return;
  var start = _pd_page * _pd_size;
  var items = _pd_filtered.slice(start, start + _pd_size);
  var html  = '';

  items.forEach(function(item, idx) {
    var gIdx  = start + idx;
    var isExp = _pd_expanded.has(gIdx);
    var srcKeys = Object.keys(item.sources);

    var pd = _pd_src === 'all'   ? item.pd_all   :
             _pd_src === '2022'  ? item.pd_2022  :
             _pd_src === '2024'  ? item.pd_2024  :
             _pd_src === 'party' ? item.pd_party : item.pd_all;
    var dispAmt = _pd_src === 'all' ? item.total
                : (item.sources[_pd_src] ? item.sources[_pd_src].total : 0);
    var pdTotal = _pd_src === 'all' ? item.total
                : (item.sources[_pd_src] ? item.sources[_pd_src].total : item.total);

    var srcColors = {'2022':{bg:'#eef0fd',color:'#5b6af0'},
                     '2024':{bg:'#fef3c7',color:'#b45309'},
                     '2018':{bg:'#fce7f3',color:'#9d174d'},
                     '2020':{bg:'#fef9c3',color:'#854d0e'},
                     'party':{bg:'#d1fae5',color:'#065f46'}};
    var srcLabels = {'2022':'2022地方','2024':'2024總統','2018':'2018地方','2020':'2020總統','party':'政黨'};
    var srcTags = srcKeys.map(function(k) {
      var c = srcColors[k]||{bg:'#f3f4f6',color:'#6b7280'};
      return '<span style="font-size:.64rem;padding:1px 7px;border-radius:10px;' +
        'background:'+c.bg+';color:'+c.color+';font-weight:600;white-space:nowrap">'+
        (srcLabels[k]||k)+'</span>';
    }).join('');
    // 計算是否有非金錢捐款
    var has_inkind = false;
    srcKeys.forEach(function(sk) {
      if (!item.sources[sk]) return;
      item.sources[sk].items.forEach(function(it) { if (it.inkind) has_inkind = true; });
    });
    item.has_inkind = has_inkind;

    var detail = '';
    if (isExp) {
      detail = '<div style="padding:10px 0 4px;border-top:1px solid var(--border);margin-top:8px">';
      var showSrcs = _pd_src === 'all' ? ['2024','2022','2020','2018','party'] : [_pd_src];
      showSrcs.forEach(function(sk) {
        if (!item.sources[sk]) return;
        var sitems = item.sources[sk].items;
        var sLabel = {'2022':'2022地方選舉','2024':'2024總統立委','2018':'2018地方選舉','2020':'2020總統立委','party':'政黨'}[sk]||sk;
        var sc = srcColors[sk]||{color:'#333',bg:'#f0f0f0'};
        detail += '<div style="margin-bottom:12px">';
        detail += '<div style="font-size:.68rem;font-weight:700;color:'+sc.color+';' +
          'background:'+sc.bg+';padding:3px 10px;border-radius:10px;display:inline-block;margin-bottom:8px">'+
          sLabel+'（'+sitems.length+' 筆，合計 '+pdAmtFull(item.sources[sk].total)+'）</div>';

        if (sk === 'party') {
          // 政黨：依年份分組
          var byYr = {};
          sitems.forEach(function(it) {
            var yr = it.yr||'?';
            if (!byYr[yr]) byYr[yr]=[];
            byYr[yr].push(it);
          });
          Object.keys(byYr).sort(function(a,b){return b-a;}).forEach(function(yr) {
            var yrLabel = {107:'2018年',108:'2019年',109:'2020年',110:'2021年',111:'2022年',112:'2023年',113:'2024年'}[parseInt(yr)]||(yr+'年');
            detail += '<div style="font-size:.7rem;color:var(--muted);margin:4px 0 3px;font-weight:600">'+yrLabel+'</div>';
            byYr[yr].forEach(function(it) {
              var pc = pdPartyColor(it.party);
              var partyRet = it.ret && it.ret !== 'nan' && it.ret !== ''
                ? '<span style="font-size:.62rem;color:var(--red);margin-left:4px">['+it.ret+']</span>' : '';
              detail += '<div style="display:flex;align-items:center;padding:5px 0;' +
                'border-bottom:1px solid var(--border);gap:8px;font-size:.8rem">' +
                '<span style="width:7px;height:7px;border-radius:50%;background:'+pc+';flex-shrink:0;display:inline-block"></span>' +
                '<div style="flex:1">'+it.party+partyRet+'</div>' +
                '<div style="color:var(--muted);font-size:.7rem;white-space:nowrap">'+pdDate(it.date)+'</div>' +
                '<div style="font-family:var(--mono);font-weight:600;color:var(--accent);white-space:nowrap">'+pdAmtFull(it.amt)+'</div>' +
                '</div>';
            });
          });
        } else {
          sitems.forEach(function(it) {
            var pc = it.pb || pdPartyColor(it.party);
            var ret = it.ret && it.ret !== 'nan' && it.ret !== ''
              ? '<span style="font-size:.62rem;color:var(--red);margin-left:4px">['+it.ret+']</span>' : '';
            var inkindBadge = it.inkind ? '<span style="font-size:.62rem;padding:1px 5px;border-radius:8px;background:#f3e8ff;color:#7c3aed;border:1px solid #c4b5fd;margin-left:5px;font-weight:600">非金錢</span>' : '';
            var elBadge = it.el
              ? '<span style="font-size:.6rem;color:#1b8c35;margin-left:4px">✦當選</span>' : '';
            detail += '<div style="display:flex;align-items:center;padding:5px 0;' +
              'border-bottom:1px solid var(--border);gap:8px;font-size:.8rem">' +
              '<span style="width:7px;height:7px;border-radius:50%;background:'+pc+';flex-shrink:0;display:inline-block"></span>' +
              '<div style="flex:1;min-width:0">' +
                '<span style="font-weight:600">'+it.cand+'</span>' +
                (it.city?'<span style="color:var(--muted);font-size:.7rem;margin-left:4px">'+it.city+'</span>':'') +
                (it.party?'<span style="font-size:.65rem;color:'+pc+';margin-left:5px;font-weight:600">'+it.party+'</span>':'') +
                elBadge + ret + (it.inkind?'<span style="font-size:.62rem;padding:1px 5px;border-radius:8px;background:#f3e8ff;color:#7c3aed;border:1px solid #c4b5fd;margin-left:4px;font-weight:600">非金錢</span>':'') +
              '</div>' +
              '<div style="color:var(--muted);font-size:.7rem;white-space:nowrap">'+pdDate(it.date)+'</div>' +
              '<div style="font-family:var(--mono);font-weight:600;color:var(--accent);white-space:nowrap">'+pdAmtFull(it.amt)+'</div>' +
              '</div>';
          });
        }
        detail += '</div>';
      });
      detail += '</div>';
    }

    html += '<div class="ud-item-card">' +
      '<div style="display:flex;align-items:center;gap:10px;cursor:pointer" onclick="pdToggle('+gIdx+')">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:.88rem;font-weight:600">' +
            item.name +
            '<span style="font-size:.7rem;color:var(--muted);font-weight:400;margin-left:6px">'+
              (item.addr||'') +
            '</span>' +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:5px;align-items:center">' +
            '<span style="font-size:.68rem;color:var(--muted)">· '+item.nc+' 位受捐人/政黨</span>' +
          '</div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0">' +
          '<div style="font-size:.95rem;font-weight:700;font-family:var(--mono);color:var(--accent)">'+pdAmt(dispAmt)+'</div>' +
          '<div style="font-size:.68rem;color:var(--muted)">'+(_pd_src==='all'?'總計':({'2022':'2022地方','2024':'2024總統','2018':'2018地方','2020':'2020總統','party':'政黨'}[_pd_src]||''))+'</div>' +
        '</div>' +
        '<div style="color:var(--muted);font-size:.8rem;flex-shrink:0">'+(isExp?'▲':'▼')+'</div>' +
      '</div>' +
      pdPartyBar(pd, pdTotal) +
      detail +
    '</div>';
  });

  var hasMore = (_pd_page+1)*_pd_size < _pd_filtered.length;
  if (hasMore) {
    html += '<div style="text-align:center;padding:12px 12px 80px;display:flex;justify-content:center;gap:8px">' +
      '<button onclick="pdLoadMore()" style="font-size:.78rem;padding:8px 24px;border-radius:8px;' +
        'border:1.5px solid var(--border);background:var(--surface);color:var(--accent);' +
        'cursor:pointer;font-weight:600">' +
        '載入更多（'+Math.min((_pd_page+1)*_pd_size,_pd_filtered.length)+' / '+_pd_filtered.length+'）' +
      '</button>' +
      (_pd_page > 0 ? '<button onclick="pdPrevPage()" style="font-size:.78rem;padding:8px 24px;border-radius:8px;border:1.5px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer;font-weight:600">上一頁</button>' : '') +
    '</div>';
  }

  listEl.innerHTML = html;
}

function pdToggle(idx) {
  if (_pd_expanded.has(idx)) { _pd_expanded.delete(idx); }
  else { _pd_expanded.clear(); _pd_expanded.add(idx); };
  pdRenderList();
}
function pdPrevPage() {
  if (_pd_page <= 0) return;
  _pd_page--;
  pdRenderList();
  setTimeout(function() {
    var listEl = document.getElementById('pd-list');
    if (!listEl) return;
    var barH = document.getElementById('ud-mobile-filter-bar');
    var barHeight = barH ? barH.offsetHeight + 8 : 8;
    listEl.style.scrollMarginTop = barHeight + 'px';
    listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

function pdLoadMore() {
  _pd_page++;
  pdRenderList();
  setTimeout(function() {
    var listEl = document.getElementById('pd-list');
    if (!listEl) return;
    var barH = document.getElementById('ud-mobile-filter-bar');
    var barHeight = barH ? barH.offsetHeight + 8 : 8;
    listEl.style.scrollMarginTop = barHeight + 'px';
    listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}
function pdSetSrc(v)  { _pd_src  = v; pdApplyFilter(); }
function pdSetNc(v)   { _pd_nc   = v; pdApplyFilter(); }
function pdSetSort(v) { _pd_sort = v; pdApplyFilter(); }

function initPersonalDonorPage() {
  var target = document.getElementById('page-donor-pers');
  if (!target) return;
  if (target.dataset.pdInit) return;
  target.dataset.pdInit = '1';

  target.innerHTML =
    '<div style="display:flex;width:100%;height:100%;overflow:hidden;flex-direction:var(--donor-dir,row)">' +
    '<div id="pd-filter-panel" style="width:200px;flex-shrink:0;border-right:1px solid var(--border);' +
         'padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:12px;background:var(--surface)">' +
      '<div>' +
        '<div style="font-size:.68rem;font-weight:700;color:var(--muted);letter-spacing:.08em;' +
                    'text-transform:uppercase;margin-bottom:6px">搜尋</div>' +
        '<div style="position:relative">' +
          '<span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);' +
                       'color:var(--muted);font-size:.78rem">&#128269;</span>' +
          '<input id="pd-search" type="text" placeholder="姓名或地區..." autocomplete="off"' +
            ' style="width:100%;background:var(--surface2);border:1.5px solid var(--border);' +
                    'color:var(--text);padding:7px 8px 7px 28px;border-radius:var(--radius-sm);' +
                    'font-size:.76rem;font-family:var(--sans);outline:none;box-sizing:border-box">' +
        '</div>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:.68rem;font-weight:700;color:var(--muted);letter-spacing:.08em;' +
                    'text-transform:uppercase;margin-bottom:6px">來源</div>' +
        '<select id="pd-src-select" class="ud-select" onchange="pdSetSrc(this.value)">' +
          '<option value="all">全部來源</option>' +
          '<option value="2024">2024 總統立委</option>' +
          '<option value="2022">2022 地方選舉</option>' +
          '<option value="party">政黨</option>' +
        '</select>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:.68rem;font-weight:700;color:var(--muted);letter-spacing:.08em;' +
                    'text-transform:uppercase;margin-bottom:6px">捐款人數</div>' +
        '<select id="pd-nc-select" class="ud-select" onchange="pdSetNc(this.value)">' +
          '<option value="all">全部</option>' +
          '<option value="1">只捐 1 人</option>' +
          '<option value="2">2 人以上</option>' +
          '<option value="5">5 人以上</option>' +
        '</select>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:.68rem;font-weight:700;color:var(--muted);letter-spacing:.08em;' +
                    'text-transform:uppercase;margin-bottom:6px">排序</div>' +
        '<select id="pd-sort-select" class="ud-select" onchange="pdSetSort(this.value)">' +
          '<option value="total">捐款總額</option>' +
          '<option value="nc">受捐人數</option>' +
          '<option value="cross">跨黨程度</option>' +
        '</select>' +
      '</div>' +
    '</div>' +
    '<div style="flex:1;overflow-y:auto;padding:16px 20px;background:var(--bg)">' +
      '<div id="pd-meta" style="font-size:.72rem;color:var(--muted);margin-bottom:12px"></div>' +
      '<div id="pd-list"></div>' +
    '</div>' +
    '</div>';

  document.getElementById('pd-search').addEventListener('input', function() {
    _pd_query = this.value; pdApplyFilter();
  });

  if (window.innerWidth <= 900) pdShowMobileFilterBar();
  if (window._PERSONAL_UNIFIED) pdApplyFilter();
}

function pdShowMobileFilterBar() {
  // 個人頁使用共用的 ud-mobile-filter-bar，不重複建立
  // onclick 已由 switchDonorTab 統一管理
}

function pdOpenDonorSheet() {
  var body = document.getElementById('donor-sheet-body');
  if (!body) return;
  body.innerHTML =
    '<div style="margin-bottom:16px">' +
      '<label style="font-size:.78rem;font-weight:600;color:var(--muted);display:block;margin-bottom:6px">來源</label>' +
      '<select id="pd-sheet-src" class="ud-select" style="font-size:.82rem">' +
        '<option value="all">全部來源</option>' +
        '<option value="2024">2024 總統立委</option>' +
        '<option value="2022">2022 地方選舉</option>' +
        '<option value="2020">2020 總統立委</option>' +
        '<option value="2018">2018 地方選舉</option>' +
        '<option value="party">政黨</option>' +
      '</select>' +
    '</div>' +
    '<div style="margin-bottom:16px">' +
      '<label style="font-size:.78rem;font-weight:600;color:var(--muted);display:block;margin-bottom:6px">捐款人數</label>' +
      '<select id="pd-sheet-nc" class="ud-select" style="font-size:.82rem">' +
        '<option value="all">全部</option>' +
        '<option value="1">只捐 1 人</option>' +
        '<option value="2">2 人以上</option>' +
        '<option value="5">5 人以上</option>' +
      '</select>' +
    '</div>' +
    '<div style="margin-bottom:16px">' +
      '<label style="font-size:.78rem;font-weight:600;color:var(--muted);display:block;margin-bottom:6px">排序</label>' +
      '<select id="pd-sheet-sort" class="ud-select" style="font-size:.82rem">' +
        '<option value="total">捐款總額</option>' +
        '<option value="nc">受捐人數</option>' +
        '<option value="cross">跨黨程度</option>' +
      '</select>' +
    '</div>';

  document.getElementById('pd-sheet-src').value  = _pd_src;
  document.getElementById('pd-sheet-nc').value   = _pd_nc;
  document.getElementById('pd-sheet-sort').value = _pd_sort;

  var footer = document.getElementById('donor-sheet-footer');
  if (footer) {
    footer.innerHTML =
      '<button onclick="pdResetSheet()" style="flex:1;padding:12px;border-radius:8px;' +
        'border:1.5px solid var(--border);background:var(--surface);color:var(--text);' +
        'font-size:.82rem;font-weight:600;cursor:pointer;font-family:var(--sans)">清除篩選</button>' +
      '<button onclick="pdApplySheet();closeDonorSheet()" style="flex:1;padding:12px;border-radius:8px;' +
        'border:none;background:var(--accent);color:#fff;font-size:.82rem;' +
        'font-weight:600;cursor:pointer;font-family:var(--sans)">套用篩選</button>';
  }

  var overlay = document.getElementById('donor-sheet-overlay');
  var sheet   = document.getElementById('donor-sheet');
  if (!overlay || !sheet) return;
  overlay.style.display = 'block';
  requestAnimationFrame(function() { requestAnimationFrame(function() {
    overlay.classList.add('visible');
    sheet.classList.add('open');
  }); });
  document.body.style.overflow = 'hidden';
}

function pdApplySheet() {
  var src  = document.getElementById('pd-sheet-src');
  var nc   = document.getElementById('pd-sheet-nc');
  var sort = document.getElementById('pd-sheet-sort');
  if (src)  _pd_src  = src.value;
  if (nc)   _pd_nc   = nc.value;
  if (sort) _pd_sort = sort.value;
  if (window._PERSONAL_UNIFIED) pdApplyFilter();
}

function pdResetSheet() {
  _pd_src = 'all'; _pd_nc = 'all'; _pd_sort = 'total'; _pd_query = '';
  var msi = document.getElementById('pd-mobile-search');
  if (msi) msi.value = '';
  if (window._PERSONAL_UNIFIED) pdApplyFilter();
  closeDonorSheet();
}

// ══ 政黨同場排名 ══
var _partyRankYr  = '113';
var _partyRankKey = 'income';

function renderPartyRank() {
  var container = document.getElementById('party-rank-container');
  if (!container) return;

  var yr  = activePartyYr || '113';
  var key = _partyRankKey || 'income';

  var rows = [];
  Object.keys(_PARTY_DATA).forEach(function(name) {
    var pdata = _PARTY_DATA[name];
    var yrd   = pdata.years[yr];
    if (!yrd || !yrd.r1) return;
    var r1  = yrd.r1;
    rows.push({
      name:    name,
      color:   pdata.color ? pdata.color.bg    : '#9e9e9e',
      light:   pdata.color ? pdata.color.light  : '#f5f5f5',
      income:  r1['收入合計']  || 0,
      balance: r1['本期結餘'] || 0,
      val:     key === 'income' ? (r1['收入合計']||0) : (r1['本期結餘']||0),
    });
  });

  rows.sort(function(a,b){ return b.val - a.val; });
  var maxAbs = Math.max.apply(null, rows.map(function(r){ return Math.abs(r.val); })) || 1;

  function fmtA(n) {
    if (!n && n !== 0) return '—';
    var abs = Math.abs(n), sign = n < 0 ? '-' : '';
    if (abs >= 1e8) return sign+(abs/1e8).toFixed(1)+' 億';
    if (abs >= 1e4) return sign+Math.round(abs/1e4)+' 萬';
    return n.toLocaleString();
  }

  var yrLabel = {107:'2018年',108:'2019年',109:'2020年',110:'2021年',111:'2022年',112:'2023年',113:'2024年'}[parseInt(yr)] || yr+'年';

  var out =
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:16px;flex-wrap:wrap">' +
    [['income','收入'],['balance','結餘']].map(function(kd) {
      var a = kd[0] === key;
      return '<button onclick="partyRankSwitch(\''+yr+'\',\''+kd[0]+'\')" style="font-size:.68rem;padding:3px 10px;border-radius:20px;cursor:pointer;font-family:inherit;border:1.5px solid '+(a?'var(--accent)':'var(--border)')+';background:'+(a?'var(--accent-lt)':'var(--surface)')+';color:'+(a?'var(--accent)':'var(--muted)')+'">'+kd[1]+'</button>';
    }).join('') +
    '</div>' +
    '<div style="font-size:.7rem;color:var(--muted);margin-bottom:10px">'+yrLabel+' '+(key==='income'?'收入':'結餘')+' 排名（共 '+rows.length+' 個政黨申報）</div>';

  var medals = ['🥇','🥈','🥉'];
  rows.forEach(function(r, i) {
    var isMe = r.name === activeParty;
    var pct  = Math.round(Math.abs(r.val) / maxAbs * 100);
    var barColor = r.val < 0 ? '#ef5350' : (isMe ? 'var(--accent)' : r.color);
    out +=
      '<div style="display:flex;align-items:center;padding:8px 10px;border-radius:8px;gap:10px;margin-bottom:2px;' +
        'background:'+(isMe?'var(--accent-lt)':'transparent')+';border:1px solid '+(isMe?'var(--accent)':'transparent')+'">' +
        '<div style="width:22px;min-width:22px;max-width:22px;overflow:hidden;text-align:center;font-size:.72rem;font-weight:700;flex-shrink:0;color:'+(isMe?'var(--accent)':'var(--muted)')+'">'+((i<3)?medals[i]:(i+1))+'</div>' +
        '<div style="width:28px;height:28px;border-radius:8px;flex-shrink:0;background:'+r.color+';display:flex;align-items:center;justify-content:center;font-size:.62rem;font-weight:700;color:#fff">'+r.name.slice(0,2)+'</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:.82rem;font-weight:'+(isMe?'700':'500')+';color:'+(isMe?'var(--accent)':'var(--text)')+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+r.name+(isMe?' <span style="font-size:.65rem">（本黨）</span>':'')+  '</div>' +
          '<div style="margin-top:4px;height:5px;background:var(--border);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:'+barColor+';border-radius:3px"></div></div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0">' +
          '<div style="font-size:.85rem;font-weight:600;font-family:var(--mono);color:'+(r.val<0?'#ef5350':'var(--accent)')+'">'+fmtA(r.val)+'</div>' +
          '<div style="font-size:.62rem;color:var(--muted)">'+_fmtRankPct(r.val,maxAbs)+'%</div>' +
        '</div>' +
      '</div>';
  });

  // 本黨小結
  var myIdx = rows.findIndex(function(r){ return r.name === activeParty; });
  if (myIdx !== -1) {
    var other = rows.slice().sort(function(a,b){ return b[key==='income'?'balance':'income'] - a[key==='income'?'balance':'income']; });
    var otherIdx = other.findIndex(function(r){ return r.name === activeParty; });
    out += '<div style="margin-top:14px;padding:10px 14px;background:var(--surface);border-radius:8px;border:1px solid var(--border);font-size:.78rem">' +
      '<span style="font-weight:700;color:var(--accent)">'+activeParty+'</span>　'+yrLabel+'　' +
      '收入排名 <b>'+(key==='income'?myIdx+1:otherIdx+1)+'</b> / '+rows.length+'　　' +
      '結餘排名 <b>'+(key==='balance'?myIdx+1:otherIdx+1)+'</b> / '+rows.length+
    '</div>';
  }

  // 用 p-section 包裹排名列表
  var ctrl = '';
  var list = '';
  // 找控制列（收入/結餘切換）和標題行 → ctrl
  // 找排名列表 → list
  var ctrlEnd = out.indexOf('</div>', out.indexOf('margin-bottom:14px')) + 6;
  var titleEnd = out.indexOf('</div>', ctrlEnd) + 6;
  ctrl = out.slice(0, titleEnd);
  list = out.slice(titleEnd);
  container.innerHTML = ctrl +
    '<div class="p-section" style="padding:14px 16px;margin-top:4px">' + list + '</div>';
}

function partyRankSwitch(yr, key) {
  _partyRankKey = key;
  renderPartyRank();
}

// ══ 候選人同場排名（照政黨頁風格）══
var _candRankKey = 'income';

function _fmtRankPct(val, maxVal) {
  if (!maxVal || !val) return '0';
  var sign = val < 0 ? '-' : '';
  const r = Math.abs(val) / maxVal * 100;
  if (r >= 1) return sign + String(Math.round(r));
  for (var d = 1; d <= 4; d++) {
    if (Math.round(r * Math.pow(10, d)) > 0) return sign + r.toFixed(d);
  }
  return sign + '<0.0001';
}

function renderCandRank() {
  var container = document.getElementById('cand-rank-container');
  if (!container || !activeKey) return;

  var key = window._candRankKey || 'income';
  var parts = activeKey.split('||');
  var name = parts[0], ename = parts[1];
  var candObj = ALL.find(function(c){ return c.n === name && c.e === ename; });
  if (!candObj) return;

  var sameEl;
  if (candObj.cat === '總統') {
    sameEl = ALL.filter(function(c){ return c.cat === '總統'; });
  } else if (candObj.cat === '區域立委') {
    sameEl = ALL.filter(function(c){ return c.cat === '區域立委' && c.c === candObj.c; });
  } else if (candObj.cat === '山地原住民立委' || candObj.cat === '平地原住民立委') {
    sameEl = ALL.filter(function(c){ return c.cat === candObj.cat; });
  } else {
    // 同選舉名稱 + 同縣市（避免 2018 跨縣市合併）
    sameEl = ALL.filter(function(c){
      return c.e === candObj.e && (!candObj.c || !c.c || c.c === candObj.c);
    });
  }

  var incKey = '收入小計', balKey = '餘額';
  var sortKey = key === 'income' ? incKey : balKey;

  var rows = sameEl.map(function(c) {
    var r1 = c.r1 || {};
    return {
      name: c.n, party: c.party || '無黨籍',
      color: (c.party_color||{}).bg||'#9e9e9e',
      text:  (c.party_color||{}).text||'#fff',
      elected: c.elected || false, city: c.c || '',
      income: r1[incKey]||0, balance: r1[balKey]||0, val: r1[sortKey]||0,
    };
  }).sort(function(a,b){ return b.val - a.val; });

  var maxAbs = Math.max.apply(null, rows.map(function(r){ return Math.abs(r.val); })) || 1;

  function fmtA(n) {
    if (!n && n !== 0) return '—';
    var abs = Math.abs(n), sign = n < 0 ? '-' : '';
    if (abs >= 1e8) return sign+(abs/1e8).toFixed(1)+' 億';
    if (abs >= 1e4) return sign+Math.round(abs/1e4)+' 萬';
    return n.toLocaleString();
  }

  var medals = ['🥇','🥈','🥉'];
  var keyLabel = key === 'income' ? '收入' : '結餘';

  var ctrl =
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;flex-wrap:wrap">' +
    [['income','收入'],['balance','結餘']].map(function(kd) {
      var a = kd[0] === key;
      return '<button onclick="candRankSwitch(\''+kd[0]+'\')" style="font-size:.68rem;padding:3px 10px;border-radius:20px;cursor:pointer;font-family:inherit;border:1.5px solid '+(a?'var(--accent)':'var(--border)')+';background:'+(a?'var(--accent-lt)':'var(--surface)')+';color:'+(a?'var(--accent)':'var(--muted)')+'">'+kd[1]+'</button>';
    }).join('') +
    '</div>' +
    '<div style="font-size:.7rem;color:var(--muted);margin-bottom:10px">'+keyLabel+' 排名（共 '+rows.length+' 位同場候選人）</div>';

  var list = '';
  rows.forEach(function(r, i) {
    var isMe = r.name === name;
    var pct  = Math.round(Math.abs(r.val) / maxAbs * 100);
    var barColor = r.val < 0 ? '#ef5350' : (isMe ? 'var(--accent)' : r.color);
    list +=
      '<div style="display:flex;align-items:center;padding:8px 10px;border-radius:8px;gap:10px;margin-bottom:2px;background:'+(isMe?'var(--accent-lt)':'transparent')+';border:1px solid '+(isMe?'var(--accent)':'transparent')+';">' +
        '<div style="width:22px;text-align:center;font-size:.72rem;font-weight:700;color:'+(isMe?'var(--accent)':'var(--muted)')+';">'+(i<3?medals[i]:(i+1))+'</div>' +
        '<div style="width:28px;height:28px;border-radius:8px;flex-shrink:0;background:'+r.color+';display:flex;align-items:center;justify-content:center;font-size:.62rem;font-weight:700;color:'+r.text+'">'+r.name.slice(0,1)+'</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:3px">' +
            '<span style="font-size:.82rem;font-weight:'+(isMe?'700':'500')+';color:'+(isMe?'var(--accent)':'var(--text)')+'">'+r.name+'</span>' +
            '<span style="font-size:.65rem;padding:1px 6px;border-radius:10px;background:'+r.color+'18;color:'+r.color+';border:1px solid '+r.color+'44;font-weight:600">'+r.party+'</span>' +
            (r.elected?'<span class="elected-badge" style="font-size:.62rem;padding:1px 5px">✦ 當選</span>':'') +
          '</div>' +
          '<div style="height:5px;background:var(--border);border-radius:3px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:'+barColor+';border-radius:3px"></div></div>' +
        '</div>' +
        '<div style="text-align:right;flex-shrink:0">' +
          '<div style="font-size:.85rem;font-weight:600;font-family:var(--mono);color:'+(r.val<0?'#ef5350':'var(--accent)')+'">'+fmtA(r.val)+'</div>' +
          '<div style="font-size:.62rem;color:var(--muted)">'+_fmtRankPct(r.val,maxAbs)+'%</div>' +
        '</div>' +
      '</div>';
  });

  // 本人小結
  var myIdx = rows.findIndex(function(r){ return r.name === name; });
  if (myIdx !== -1) {
    var otherRows = rows.slice().sort(function(a,b){ return b[key==='income'?'balance':'income'] - a[key==='income'?'balance':'income']; });
    var otherIdx = otherRows.findIndex(function(r){ return r.name === name; });
    list += '<div style="margin-top:10px;padding:10px 14px;background:var(--surface2);border-radius:8px;border:1px solid var(--border);font-size:.78rem">' +
      '<span style="font-weight:700;color:var(--accent)">'+name+'</span>　' +
      '收入排名 <b>'+(key==='income'?myIdx+1:otherIdx+1)+'</b> / '+rows.length+'　　結餘排名 <b>'+(key==='balance'?myIdx+1:otherIdx+1)+'</b> / '+rows.length+'</div>';
  }

  container.innerHTML = ctrl +
    '<div class="p-section" style="padding:14px 16px;margin-top:4px">' + list + '</div>';
}

function candRankSwitch(key) {
  _candRankKey = key;
  renderCandRank();
}

// ── 覆蓋 switchTab：加入 rank 的呼叫 ──
(function() {
  var _origSwitchTab = window.switchTab;
  window.switchTab = function(id, btn) {
    if (id === 'rank') {
      document.querySelectorAll('.tab-pane').forEach(function(p){ p.classList.remove('active'); });
      document.querySelectorAll('.donor-tab-btn').forEach(function(b){ b.classList.remove('active'); });
      var pane = document.getElementById('tab-rank');
      if (pane) pane.classList.add('active');
      if (btn) btn.classList.add('active');
      window._candRankKey = 'income';
      setTimeout(function(){ if(typeof renderCandRank==='function') renderCandRank(); }, 0);
      return;
    }
    if (_origSwitchTab) _origSwitchTab(id, btn);
  };
})();

// ── showDetail 之後自動呼叫 renderCandRank ──
(function() {
  var _origShowDetail = window.showDetail;
  window.showDetail = function(name, ename) {
    if (_origShowDetail) _origShowDetail(name, ename);
    window._candRankKey = 'income';
    setTimeout(function(){ if(typeof renderCandRank==='function') renderCandRank(); }, 100);
  };
})();

// 覆蓋 renderCandRank：加白色底 + 用 elected-badge
(function() {
  var _orig = window.renderCandRank;
  window.renderCandRank = function() {
    if (_orig) _orig();
    // 把排名列表包在白色底裡
    var container = document.getElementById('cand-rank-container');
    if (!container || container.dataset.wrapped) return;
    // 找第一個非控制列的 div（排名列表開始）
    var children = Array.from(container.children);
    // 控制列是有 gap:6px 的 flex div，排名列表是之後的內容
    var listStart = -1;
    for (var i = 0; i < children.length; i++) {
      var style = children[i].getAttribute('style') || '';
      if (!style.includes('gap:6px') && !style.includes('font-size:.7rem')) {
        listStart = i;
        break;
      }
    }
    if (listStart === -1) return;
    // 把排名列表和小結包在 p-section 裡
    var wrapper = document.createElement('div');
    wrapper.className = 'p-section';
    wrapper.style.cssText = 'padding:14px 16px;margin-top:8px';
    // 把 listStart 之後的所有子元素移進 wrapper
    var toMove = children.slice(listStart);
    toMove.forEach(function(el) { wrapper.appendChild(el); });
    container.appendChild(wrapper);
    container.dataset.wrapped = '1';
  };
})();

// ── 右滑返回手勢 ──
(function() {
  var touchStartX = 0;
  var touchStartY = 0;
  var SWIPE_THRESHOLD = 80;   // 最小滑動距離（px）
  var EDGE_ZONE = 40;         // 從左側邊緣開始的區域（px）
  var MAX_Y_DRIFT = 60;       // 最大垂直偏移（避免誤判上下滑）

  document.addEventListener('touchstart', function(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchend', function(e) {
    var dx = e.changedTouches[0].clientX - touchStartX;
    var dy = Math.abs(e.changedTouches[0].clientY - touchStartY);

    // 必須從左側邊緣開始、向右滑、且垂直偏移不大
    if (touchStartX > EDGE_ZONE) return;
    if (dx < SWIPE_THRESHOLD) return;
    if (dy > MAX_Y_DRIFT) return;

    // 判斷目前在哪個詳細頁
    var backBtn = document.getElementById('mobile-back-btn');
    if (backBtn && backBtn.style.display !== 'none' && backBtn.offsetParent !== null) {
      backBtn.click();
      return;
    }

    // 政黨詳細頁返回
    var partyBack = document.getElementById('party-back-btn');
    if (partyBack && partyBack.offsetParent !== null) {
      partyBack.click();
      return;
    }
  }, { passive: true });
})();

// ══ 從 personal_unified 建立候選人頁反向索引 ══
function _buildPersIndexes(unified) {
  var idx2022 = [], idx2024 = [], idx2018 = [], idx2020 = [];
  unified.forEach(function(obj) {
    var base = { d: obj.name, adr: obj.addr || '', nc: obj.nc, pd: obj.pd || [] };
    ['2018','2020','2022','2024'].forEach(function(yr) {
      if (obj.sources && obj.sources[yr] && obj.sources[yr].items.length) {
        var items = obj.sources[yr].items.map(function(it) {
          // 總統連名（蔡英文、賴清德）只取正選人
          var candName = it.cand || '';
          if (candName.indexOf('、') !== -1) candName = candName.split('、')[0].trim();
          return { n: candName, c: it.city, a: it.amt, p: it.party, pb: it.pb,
                   el: it.el, t: it.date, r: it.ret || '', inkind: it.inkind || false };
        });
        var entry = Object.assign({}, base, { tot: obj.sources[yr].total, i: items });
        if (yr==='2018') idx2018.push(entry);
        else if (yr==='2020') idx2020.push(entry);
        else if (yr==='2022') idx2022.push(entry);
        else if (yr==='2024') idx2024.push(entry);
      }
    });
  });
  window._PERSONAL_DATA      = idx2022;
  window._PERSONAL_DATA_2024 = idx2024;
  window._PERSONAL_DATA_2018 = idx2018;
  window._PERSONAL_DATA_2020 = idx2020;
  var is24 = (typeof activeYear !== 'undefined' && activeYear === 2024);
  window.__ACTIVE_PERS = is24 ? idx2024 : idx2022;
  console.log('[index] 候選人個人索引 2022:', idx2022.length,
              '2024:', idx2024.length, '2018:', idx2018.length, '2020:', idx2020.length);
}

// ══ 從 personal_unified 建立政黨頁個人捐款索引 ══
function _buildPartyPersIndex(unified) {
  var idx = {};
  unified.forEach(function(obj) {
    if (!obj.sources || !obj.sources.party) return;
    obj.sources.party.items.forEach(function(it) {
      var party = it.party, yr = it.yr;
      if (!party || !yr) return;
      if (!idx[party]) idx[party] = {};
      if (!idx[party][yr]) idx[party][yr] = [];
      idx[party][yr].push({
        party: party, year: parseInt(yr),
        yr_label: it.yr_label || String(parseInt(yr) + 1911),
        name: obj.name,
        id: it.id || '', amt: it.amt, addr: obj.addr || '',
        date: it.date, ret: it.ret || '', inkind: it.inkind || false
      });
    });
  });
  window._PARTY_PERS_INDEX = idx;
  if (typeof _PARTY_DATA !== 'undefined') {
    Object.keys(idx).forEach(function(party) {
      if (!_PARTY_DATA[party]) return;
      Object.keys(idx[party]).forEach(function(yr) {
        if (!_PARTY_DATA[party].years[yr]) _PARTY_DATA[party].years[yr] = {};
        _PARTY_DATA[party].years[yr].pers_items = idx[party][yr];
        _PARTY_DATA[party].years[yr].pers_total =
          idx[party][yr].reduce(function(s,x){ return s+x.amt; }, 0);
      });
    });
    console.log('[index] 政黨個人索引注入完成');
    _CORP_IDX = null; // 強制重建交叉索引（資料注入後）
    buildDonorIndex();
    if (activeParty && typeof renderDonorSection === 'function') renderDonorSection();
  }
}

// ══ 從 donor_unified 建立政黨頁企業/組織捐款索引 ══
function _buildPartyCorpIndex(donor) {
  var idx = {};
  donor.forEach(function(obj) {
    if (!obj.sources || !obj.sources.party) return;
    obj.sources.party.items.forEach(function(it) {
      var party = it.cand, yr = it.yr;
      if (!party || !yr) return;
      if (!idx[party]) idx[party] = {};
      if (!idx[party][yr]) idx[party][yr] = { corp: [], org: [] };
      var item = { party: party, year: parseInt(yr),
                   yr_label: it.yr_label || String(parseInt(yr) + 1911),
                   name: obj.name,
                   id: it.id || '', amt: it.amt, addr: it.addr || '',
                   date: it.date, ret: it.ret || '', inkind: it.inkind || false };
      if (it.s && it.s.indexOf('營利事業') !== -1) idx[party][yr].corp.push(item);
      else idx[party][yr].org.push(item);
    });
  });
  window._PARTY_CORP_INDEX = idx;
  if (typeof _PARTY_DATA !== 'undefined') {
    Object.keys(idx).forEach(function(party) {
      if (!_PARTY_DATA[party]) return;
      Object.keys(idx[party]).forEach(function(yr) {
        if (!_PARTY_DATA[party].years[yr]) _PARTY_DATA[party].years[yr] = {};
        _PARTY_DATA[party].years[yr].corp_items = idx[party][yr].corp;
        _PARTY_DATA[party].years[yr].org_items  = idx[party][yr].org;
        _PARTY_DATA[party].years[yr].corp_total =
          idx[party][yr].corp.reduce(function(s,x){ return s+x.amt; }, 0);
        _PARTY_DATA[party].years[yr].org_total =
          idx[party][yr].org.reduce(function(s,x){ return s+x.amt; }, 0);
      });
    });
    console.log('[index] 政黨企業索引注入完成');
    _CORP_IDX = null; // 強制重建交叉索引（資料注入後）
    buildDonorIndex();
    if (activeParty && typeof renderDonorSection === 'function') renderDonorSection();
  }
}

// ══ 建立個人捐款候選人反向索引（個人捐款者 → 所捐候選人） ══
function _buildCandidatePersIdx(unified) {
  _PERS_CAND_IDX = {};
  unified.forEach(function(obj) {
    // 遮罩身分證從政黨捐款 items 取得（與 persKey() 使用的 item.id 相同）
    var maskedId = '';
    if (obj.sources && obj.sources.party && obj.sources.party.items.length) {
      maskedId = String(obj.sources.party.items[0].id || '').trim();
    }
    var key = (obj.name||'').trim() + '|' + maskedId + '|' + (obj.addr||'').trim().slice(0,8);
    if (!key || key === '||') return;
    ['2018','2020','2022','2024'].forEach(function(yr) {
      if (!obj.sources || !obj.sources[yr] || !obj.sources[yr].items.length) return;
      obj.sources[yr].items.forEach(function(it) {
        var candName = it.cand || '';
        if (candName.indexOf('、') !== -1) candName = candName.split('、')[0].trim();
        if (!candName) return;
        if (!_PERS_CAND_IDX[key]) _PERS_CAND_IDX[key] = [];
        _PERS_CAND_IDX[key].push({ cand: candName, city: it.city||'', yr: yr, amt: it.amt||0, party: it.party||'' });
      });
    });
  });
  console.log('[index] 個人→候選人索引建立完成');
  if (activeParty && typeof renderDonorSection === 'function') renderDonorSection();
}

// ══ 建立企業名稱查詢索引（名稱 → _DONOR_UNIFIED 物件） ══
function _buildCorpByName(donor) {
  _CORP_BY_NAME = {};
  donor.forEach(function(obj) {
    if (obj.name) _CORP_BY_NAME[_normName(obj.name.trim())] = obj;
  });
  console.log('[index] 企業名稱索引建立完成, 筆數:', Object.keys(_CORP_BY_NAME).length);
  if (activeParty && typeof renderDonorSection === 'function') renderDonorSection();
}