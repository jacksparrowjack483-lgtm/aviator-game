// ============================================================
//  AVIATOR CRASH GAME ENGINE — Full Implementation
//  Includes: Curve Graph, Plane Animation, Bet System,
//            Player List, History Pills, Signal Mode
// ============================================================

/* ==================== CANVAS SETUP ==================== */
const canvas  = document.getElementById('gameCanvas');
const ctx     = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width  = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
}
resizeCanvas();
window.addEventListener('resize', () => { resizeCanvas(); });

/* ==================== GAME STATE ==================== */
const STATE = { WAITING: 'waiting', FLYING: 'flying', CRASHED: 'crashed' };

let gameState    = STATE.WAITING;
let multiplier   = 1.00;
let crashPoint   = 0;        // secret crash value for this round
let startTime    = 0;
let animFrame    = null;

let balance      = 29810;
let bets         = [null, null]; // bets[0] = panel1, bets[1] = panel2
let cashedOut    = [false, false];
let waitTimer    = 0;

/* ==================== HISTORY ==================== */
let roundHistory = [];       // crash values of past rounds
let signalHistory= [];       // [{pred, actual, hit}]

/* ==================== PLAYER LIST SIMULATION ==================== */
const NAMES = ['d***5','d***4','d***3','d***8','d***9','d***1','d***6','a***7','k***2','r***0','m***5','v***3','s***1','p***9'];
const COLORS = ['#e94560','#5b8dee','#2ecc71','#f5a623','#9b59b6','#e67e22','#1abc9c','#e74c3c'];
let playerBets   = [];

/* ==================== GENERATE CRASH POINT ==================== */
// Provably-fair-style distribution: heavily weighted below 3x, occasional highs
function generateCrashPoint() {
  const r = Math.random();
  if (r < 0.45)  return +(1.00 + Math.random() * 0.8).toFixed(2);   // 45% → 1.00–1.80
  if (r < 0.65)  return +(1.80 + Math.random() * 0.8).toFixed(2);   // 20% → 1.80–2.60
  if (r < 0.78)  return +(2.60 + Math.random() * 2.0).toFixed(2);   // 13% → 2.60–4.60
  if (r < 0.88)  return +(4.60 + Math.random() * 5.0).toFixed(2);   // 10% → 4.60–9.60
  if (r < 0.95)  return +(9.60 + Math.random() *15.0).toFixed(2);   //  7% → 9.60–24.60
  return +(25   + Math.random() *75.0).toFixed(2);                   //  5% → 25–100
}

/* ==================== SIGNAL PREDICTOR ==================== */
// Uses last-5-rounds analysis + weighted random to give a "prediction"
function generateSignal(realCrash) {
  // Lean the prediction toward the real crash with some noise
  const noise  = (Math.random() - 0.5) * realCrash * 0.4;
  const pred   = Math.max(1.01, +(realCrash + noise).toFixed(2));
  const safe   = +(pred * (0.55 + Math.random() * 0.25)).toFixed(2);
  const conf   = Math.floor(55 + Math.random() * 40);
  const risks  = ['LOW 🟢', 'MEDIUM 🟡', 'HIGH 🔴'];
  const risk   = conf > 80 ? risks[0] : conf > 65 ? risks[1] : risks[2];
  const riskColor = conf > 80 ? '#2ecc71' : conf > 65 ? '#f5a623' : '#e94560';
  return { pred, safe, conf, risk, riskColor };
}

/* ==================== INIT ROUND ==================== */
function startWaiting() {
  gameState  = STATE.WAITING;
  multiplier = 1.00;
  bets       = [null, null];
  cashedOut  = [false, false];
  playerBets = generatePlayerBets();

  crashPoint = generateCrashPoint();
  const sig  = generateSignal(crashPoint);
  updateSignalPanel(sig);
  updateSignalHistoryEntry(sig);

  // UI resets
  document.getElementById('crashed-overlay').style.display = 'none';
  document.getElementById('plane-wrap').style.display      = 'none';
  document.getElementById('multi-text').classList.remove('danger');
  document.getElementById('multi-text').textContent        = '1.00x';
  document.getElementById('multi-sub').textContent         = 'Waiting for next round...';
  document.getElementById('mode-banner').textContent       = 'FUN MODE';

  resetBetButtons();
  renderPlayerList();

  let countdown = 5;
  document.getElementById('multi-sub').textContent = `Next round in ${countdown}s`;

  const cd = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      document.getElementById('multi-sub').textContent = `Next round in ${countdown}s`;
    } else {
      clearInterval(cd);
      startFlying();
    }
  }, 1000);
}

/* ==================== FLYING ==================== */
function startFlying() {
  gameState  = STATE.FLYING;
  startTime  = performance.now();
  document.getElementById('plane-wrap').style.display = 'block';
  document.getElementById('multi-sub').textContent    = 'Cash out before it flies away!';
  requestAnimationFrame(gameLoop);
}

/* ==================== GAME LOOP ==================== */
function gameLoop(ts) {
  if (gameState !== STATE.FLYING) return;

  const elapsed = (ts - startTime) / 1000;  // seconds
  // Exponential growth: mult = e^(0.1 * elapsed^1.4)
  multiplier = Math.pow(Math.E, 0.06 * Math.pow(elapsed, 1.5));
  multiplier = +multiplier.toFixed(2);

  // Auto cashout for AI players
  processPlayerAutoCashouts(multiplier);

  // Check crash
  if (multiplier >= crashPoint) {
    triggerCrash();
    return;
  }

  // Danger pulse above 5x
  const txt = document.getElementById('multi-text');
  if (multiplier >= 5) {
    txt.classList.add('danger');
  }
  txt.textContent = multiplier.toFixed(2) + 'x';

  drawCurve(elapsed);
  movePlane(elapsed);
  updateBetButtonsLive();

  requestAnimationFrame(gameLoop);
}

/* ==================== DRAW CURVE ==================== */
function drawCurve(elapsed) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const PAD_L = 50, PAD_B = 60, PAD_T = 60;
  const gW = W - PAD_L - 20;
  const gH = H - PAD_B - PAD_T;

  // Map time→X, mult→Y
  const maxT    = Math.max(elapsed * 1.1, 8);
  const maxMult = Math.max(multiplier * 1.15, 1.5);

  function tx(t)   { return PAD_L + (t / maxT) * gW; }
  function ty(m)   { return (H - PAD_B) - ((m - 1) / (maxMult - 1)) * gH; }

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth   = 1;
  for (let i = 1; i <= 5; i++) {
    const y = (H - PAD_B) - (i / 5) * gH;
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - 20, y); ctx.stroke();
  }
  // Y-axis label
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font      = '10px Segoe UI';
  for (let i = 1; i <= 5; i++) {
    const mv = 1 + (i/5) * (maxMult - 1);
    const y  = (H - PAD_B) - (i / 5) * gH;
    ctx.fillText(mv.toFixed(1)+'x', 2, y + 4);
  }

  // Glow under curve (fill)
  const steps  = 120;
  const dt     = elapsed / steps;

  ctx.beginPath();
  ctx.moveTo(tx(0), H - PAD_B);
  for (let i = 1; i <= steps; i++) {
    const t = i * dt;
    const m = Math.pow(Math.E, 0.06 * Math.pow(t, 1.5));
    ctx.lineTo(tx(t), ty(m));
  }
  ctx.lineTo(tx(elapsed), H - PAD_B);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, H - PAD_B, 0, PAD_T);
  grad.addColorStop(0, 'rgba(233,69,96,0.6)');
  grad.addColorStop(1, 'rgba(233,69,96,0.05)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Main curve line
  ctx.beginPath();
  ctx.moveTo(tx(0), H - PAD_B);
  for (let i = 1; i <= steps; i++) {
    const t = i * dt;
    const m = Math.pow(Math.E, 0.06 * Math.pow(t, 1.5));
    ctx.lineTo(tx(t), ty(m));
  }
  ctx.strokeStyle = '#e94560';
  ctx.lineWidth   = 3;
  ctx.shadowColor  = '#e94560';
  ctx.shadowBlur   = 10;
  ctx.stroke();
  ctx.shadowBlur   = 0;

  // Current point dot
  const cx = tx(elapsed), cy = ty(multiplier);
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle   = '#fff';
  ctx.shadowColor = '#fff';
  ctx.shadowBlur  = 8;
  ctx.fill();
  ctx.shadowBlur  = 0;
}

/* ==================== MOVE PLANE ==================== */
function movePlane(elapsed) {
  const W = canvas.width, H = canvas.height;
  const PAD_L = 50, PAD_B = 60, PAD_T = 60;
  const gW = W - PAD_L - 20, gH = H - PAD_B - PAD_T;

  const maxT    = Math.max(elapsed * 1.1, 8);
  const maxMult = Math.max(multiplier * 1.15, 1.5);

  const px = PAD_L + (elapsed / maxT) * gW;
  const py = (H - PAD_B) - ((multiplier - 1) / (maxMult - 1)) * gH;

  const pw = document.getElementById('plane-wrap');
  pw.style.left   = (px - 40) + 'px';
  pw.style.bottom = (H - py - 25) + 'px';
  pw.style.position = 'absolute';
}

/* ==================== CRASH ==================== */
function triggerCrash() {
  gameState = STATE.CRASHED;

  // Bust anyone who didn't cash out
  bets.forEach((b, i) => {
    if (b && !cashedOut[i]) {
      showToast(`Panel ${i+1}: Lost ₹${b.amount}`, false);
    }
  });

  // Show crash overlay
  document.getElementById('crashed-overlay').style.display = 'flex';
  document.getElementById('crashed-mult').textContent = crashPoint + 'x';
  document.getElementById('plane-wrap').style.display = 'none';
  document.getElementById('multi-text').textContent   = crashPoint + 'x';
  document.getElementById('multi-text').classList.add('danger');
  document.getElementById('mode-banner').textContent  = 'FLEW AWAY!';

  // Add to history
  addToHistory(crashPoint);
  updateBetButtonsCrashed();

  // Record signal result
  finalizeSignalHistory(crashPoint);

  // Wait, then restart
  setTimeout(startWaiting, 3500);
}

/* ==================== HISTORY PILLS ==================== */
function addToHistory(cp) {
  roundHistory.unshift(cp);
  if (roundHistory.length > 20) roundHistory.pop();
  renderHistory();
}

function renderHistory() {
  const row = document.getElementById('history-row');
  row.innerHTML = roundHistory.map(v => {
    let cls = 'hist-low';
    if (v >= 10) cls = 'hist-high';
    else if (v >= 2) cls = 'hist-mid';
    return `<span class="hist-pill ${cls}">${v.toFixed(2)}x</span>`;
  }).join('');
}

/* ==================== PLAYER BETS ==================== */
function generatePlayerBets() {
  const list = [];
  const count = 10 + Math.floor(Math.random() * 8);
  for (let i = 0; i < count; i++) {
    list.push({
      name:   NAMES[Math.floor(Math.random() * NAMES.length)],
      color:  COLORS[Math.floor(Math.random() * COLORS.length)],
      amount: (Math.floor(Math.random() * 9) + 1) * 10 + '.00',
      mult:   null,
      win:    null,
      // auto cashout at random mult for AI
      autoCO: +(1.2 + Math.random() * (crashPoint * 0.6)).toFixed(2),
    });
  }
  return list;
}

function processPlayerAutoCashouts(curMult) {
  playerBets.forEach(p => {
    if (!p.mult && p.autoCO <= curMult && p.autoCO < crashPoint) {
      p.mult = p.autoCO.toFixed(2) + 'x';
      p.win  = (parseFloat(p.amount) * p.autoCO).toFixed(2);
      renderPlayerList();
    }
  });
}

function renderPlayerList() {
  const list = document.getElementById('bets-list');
  list.innerHTML = playerBets.map(p => {
    const multCell = p.mult ? `<span class="bet-mult">${p.mult}</span>` : '';
    const winCell  = p.win  ? `<span class="bet-win">${p.win}</span>`  : '';
    const letter   = p.name[0].toUpperCase();
    return `<div class="bet-row">
      <div class="player-cell">
        <div class="avatar" style="background:${p.color}">${letter}</div>
        <span>${p.name}</span>
      </div>
      <span>${p.amount}</span>
      ${multCell || '<span></span>'}
      ${winCell  || '<span></span>'}
    </div>`;
  }).join('');

  // Summary
  const cashedCount = playerBets.filter(p => p.mult).length;
  const totalWin    = playerBets.reduce((s, p) => s + (p.win ? parseFloat(p.win) : 0), 0);
  document.getElementById('bets-count').textContent    = `${cashedCount}/${playerBets.length} Bets`;
  document.getElementById('bets-win-total').textContent = totalWin.toFixed(2);
}

/* ==================== SIGNAL PANEL ==================== */
let currentSignal = null;

function updateSignalPanel(sig) {
  currentSignal = sig;
  document.getElementById('sig-crash').textContent = sig.pred + 'x';
  document.getElementById('sig-safe').textContent  = sig.safe + 'x';
  document.getElementById('sig-risk').textContent  = sig.risk;
  document.getElementById('sig-risk').style.color  = sig.riskColor;
  document.getElementById('conf-bar').style.width  = sig.conf + '%';
  document.getElementById('conf-pct').textContent  = sig.conf + '%';
}

function updateSignalHistoryEntry(sig) {
  // placeholder — actual crash filled in finalizeSignalHistory
  signalHistory.unshift({ pred: sig.pred, actual: null, hit: null });
  if (signalHistory.length > 5) signalHistory.pop();
}

function finalizeSignalHistory(actualCrash) {
  if (signalHistory.length > 0 && signalHistory[0].actual === null) {
    const entry  = signalHistory[0];
    entry.actual = actualCrash;
    // "hit" = player would have won if they cashed out at safe zone
    entry.hit    = currentSignal && (actualCrash >= currentSignal.safe);
  }
  renderSignalHistory();
}

function renderSignalHistory() {
  const el = document.getElementById('sig-history-list');
  el.innerHTML = signalHistory.map(e => {
    if (e.actual === null) return `<div class="sh-row"><span class="sh-pred">~${e.pred}x</span><span>Pending...</span><span>—</span></div>`;
    const hitLabel = e.hit ? '✅ HIT' : '❌ MISS';
    const hitClass = e.hit ? 'hit' : 'miss';
    return `<div class="sh-row">
      <span class="sh-pred">~${e.pred}x</span>
      <span class="sh-actual">${e.actual}x</span>
      <span class="sh-result ${hitClass}">${hitLabel}</span>
    </div>`;
  }).join('');
}

function toggleSignal() {
  const panel = document.getElementById('signal-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

/* ==================== BET CONTROLS ==================== */
function placeBet(panel) {
  const idx    = panel - 1;
  const btn    = document.getElementById(`bet${panel}-btn`);
  const amtEl  = document.getElementById(`bet${panel}-amount`);
  const amount = parseFloat(amtEl.value);

  if (gameState === STATE.FLYING && bets[idx] && !cashedOut[idx]) {
    // CASH OUT
    const win = +(amount * multiplier).toFixed(2);
    cashedOut[idx] = true;
    balance += win;
    updateBalanceDisplay();
    showToast(`🎉 Cashed out @ ${multiplier.toFixed(2)}x  +₹${win}`, true);
    btn.className  = 'bet-btn disabled';
    btn.innerHTML  = `Cashed Out!<br/><span>${multiplier.toFixed(2)}x</span>`;
    return;
  }

  if (gameState === STATE.WAITING || gameState === STATE.CRASHED) {
    if (isNaN(amount) || amount <= 0) { alert('Enter a valid bet amount.'); return; }
    if (amount > balance) { alert('Insufficient balance!'); return; }
    bets[idx] = { amount };
    balance  -= amount;
    updateBalanceDisplay();
    btn.className = 'bet-btn disabled';
    btn.innerHTML = `Bet Placed!<br/><span>₹${amount.toFixed(2)}</span>`;
    return;
  }

  if (gameState === STATE.FLYING && !bets[idx]) {
    alert('Round in progress. Wait for next round.');
  }
}

function updateBetButtonsLive() {
  [1, 2].forEach(p => {
    const idx = p - 1;
    const btn = document.getElementById(`bet${p}-btn`);
    const amt = document.getElementById(`bet${p}-amount`).value;
    if (bets[idx] && !cashedOut[idx]) {
      const potential = +(parseFloat(amt) * multiplier).toFixed(2);
      btn.className = 'bet-btn cashout';
      btn.innerHTML = `CASH OUT<br/><span>${potential} USD</span>`;
    }
  });
}

function updateBetButtonsCrashed() {
  [1, 2].forEach(p => {
    const btn = document.getElementById(`bet${p}-btn`);
    btn.className = 'bet-btn disabled';
    btn.innerHTML = `Bet<br/><span id="bet${p}-label">${document.getElementById(`bet${p}-amount`).value} USD</span>`;
  });
}

function resetBetButtons() {
  [1, 2].forEach(p => {
    const btn = document.getElementById(`bet${p}-btn`);
    btn.className = 'bet-btn green';
    const amt = document.getElementById(`bet${p}-amount`).value;
    btn.innerHTML = `Bet<br/><span id="bet${p}-label">${parseFloat(amt).toFixed(2)} USD</span>`;
  });
}

function changeAmt(panel, delta) {
  const el  = document.getElementById(`bet${panel}-amount`);
  const val = Math.max(1, parseFloat(el.value || 0) + delta);
  el.value  = val.toFixed(2);
  updateBetLabel(panel);
}

function setAmt(panel, val) {
  const el = document.getElementById(`bet${panel}-amount`);
  el.value = val.toFixed(2);
  updateBetLabel(panel);
}

function updateBetLabel(panel) {
  const lbl = document.getElementById(`bet${panel}-label`);
  const val = document.getElementById(`bet${panel}-amount`).value;
  if (lbl) lbl.textContent = parseFloat(val).toFixed(2) + ' USD';
}

document.querySelectorAll('.amt-input').forEach(inp => {
  inp.addEventListener('input', () => {
    const p = inp.id === 'bet1-amount' ? 1 : 2;
    updateBetLabel(p);
  });
});

/* ==================== BET MODE TABS ==================== */
function setBetMode(el, panel, mode) {
  el.closest('.bet-panel-tabs').querySelectorAll('.bptab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

/* ==================== BALANCE ==================== */
function updateBalanceDisplay() {
  document.getElementById('top-balance').textContent =
    balance.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' USD';
}

/* ==================== TABS ==================== */
function switchTab(el, mode) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}

/* ==================== TOAST ==================== */
function showToast(msg, isWin) {
  const t = document.getElementById('win-toast');
  document.getElementById('win-toast-msg').textContent = msg;
  t.style.background = isWin
    ? 'linear-gradient(135deg,#1e3a20,#2ecc71)'
    : 'linear-gradient(135deg,#3a1010,#e94560)';
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2500);
}

/* ==================== INITIAL HISTORY (fake past rounds) ==================== */
function seedHistory() {
  const seeds = [1.00, 1.33, 1.00, 15.23, 1.00, 2.51, 1.43, 1.25, 1.16, 1.17, 1.76, 3.21, 1.09, 6.22, 8.71, 2.06, 1.29, 30.25, 1.80, 1.50];
  seeds.forEach(v => roundHistory.push(v));
  renderHistory();
}

/* ==================== START ==================== */
seedHistory();
startWaiting();
