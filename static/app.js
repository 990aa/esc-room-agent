const DOM = {
  roomCanvas: document.getElementById('room-canvas'),
  relationLayer: document.getElementById('relation-layer'),
  inferenceLayer: document.getElementById('inference-layer'),
  stepCounter: document.getElementById('step-counter'),
  observedList: document.getElementById('observed-facts-list'),
  inferredList: document.getElementById('inferred-facts-list'),
  thisStepContent: document.getElementById('this-step-content'),
  historyStrip: document.getElementById('history-strip'),
  
  btnStep: document.getElementById('btn-step'),
  btnReset: document.getElementById('btn-reset'),
  btnReplay: document.getElementById('btn-replay'),
  
  toggleSlowStep: document.getElementById('toggle-slow-step'),
  toggleAutoplay: document.getElementById('toggle-autoplay'),
  sliderSpeed: document.getElementById('slider-speed'),
  speedLabel: document.getElementById('speed-label'),
  
  winOverlay: document.getElementById('win-overlay'),
  winSteps: document.getElementById('win-steps'),
  winFacts: document.getElementById('win-facts'),
  confettiContainer: document.getElementById('confetti-container')
};

let ws = null;
let state = {
  prevObjects: new Map(),
  observedRendered: 0,
  inferredRendered: 0,
  historyRendered: new Set(),
  autoplayTimer: null,
  isSlowStepping: false,
  pendingPayload: null,
  speed: 800
};

// --- Initialization ---

function init() {
  connectWebSocket();
  bindControls();
  window.addEventListener('resize', redrawLines);
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  
  ws.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.error) return console.error(payload.error);
    handlePayload(payload);
  };
  
  ws.onclose = () => setTimeout(connectWebSocket, 1000);
}

function bindControls() {
  DOM.btnStep.addEventListener('click', () => sendCommand('step'));
  DOM.btnReset.addEventListener('click', () => sendCommand('reset'));
  DOM.btnReplay.addEventListener('click', () => {
    hideWin();
    sendCommand('reset');
  });
  
  DOM.toggleAutoplay.addEventListener('change', (e) => {
    if (e.target.checked) startAutoplay();
    else stopAutoplay();
  });
  
  DOM.sliderSpeed.addEventListener('input', (e) => {
    state.speed = parseInt(e.target.value, 10);
    DOM.speedLabel.textContent = `${state.speed}ms`;
    if (DOM.toggleAutoplay.checked) startAutoplay(); // Reset timer with new speed
  });
}

function sendCommand(cmd) {
  if (state.isSlowStepping) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ command: cmd }));
  }
}

// --- Autoplay ---

function startAutoplay() {
  stopAutoplay();
  state.autoplayTimer = setInterval(() => {
    if (document.getElementById('win-overlay') && !document.getElementById('win-overlay').classList.contains('hidden')) {
      stopAutoplay();
      DOM.toggleAutoplay.checked = false;
      return;
    }
    if (!state.isSlowStepping) {
      sendCommand('step');
    }
  }, state.speed);
}

function stopAutoplay() {
  if (state.autoplayTimer) {
    clearInterval(state.autoplayTimer);
    state.autoplayTimer = null;
  }
}

// --- Payload Handling ---

async function handlePayload(payload) {
  if (payload.step === 0) {
    fullReset();
    renderImmediate(payload);
    return;
  }
  
  if (DOM.toggleSlowStep.checked && !state.isSlowStepping) {
    await renderSlowStep(payload);
  } else {
    renderImmediate(payload);
  }
}

function fullReset() {
  state.prevObjects.clear();
  state.observedRendered = 0;
  state.inferredRendered = 0;
  state.historyRendered.clear();
  
  DOM.observedList.innerHTML = '';
  DOM.inferredList.innerHTML = '';
  DOM.historyStrip.innerHTML = '';
  DOM.thisStepContent.innerHTML = '<p class="placeholder-text">Waiting for agent to act...</p>';
  hideWin();
}

function renderImmediate(payload) {
  DOM.stepCounter.textContent = payload.step;
  
  renderRoom(payload.room.objects);
  renderObserved(payload.observed_facts);
  renderInferred(payload.inferred_facts, payload.room.objects);
  
  renderThisStep(payload, "Complete");
  renderHistory(payload);
  
  if (payload.game_won) showWin(payload);
  
  // Save state for diffing next step
  cacheObjects(payload.room.objects);
}

async function renderSlowStep(payload) {
  state.isSlowStepping = true;
  DOM.stepCounter.textContent = payload.step;
  
  // Sub-phase 1: Perceiving
  renderRoom(payload.room.objects);
  renderThisStep(payload, "Perceiving...");
  await delay(600);
  
  // Sub-phase 2: Inferring
  renderObserved(payload.observed_facts);
  renderThisStep(payload, "Inferring...");
  await delay(600);
  
  // Sub-phase 3: Acting
  renderInferred(payload.inferred_facts, payload.room.objects);
  renderThisStep(payload, "Acting...");
  await delay(600);
  
  renderHistory(payload);
  if (payload.game_won) showWin(payload);
  
  cacheObjects(payload.room.objects);
  state.isSlowStepping = false;
}

const delay = ms => new Promise(res => setTimeout(res, ms));

function cacheObjects(objects) {
  state.prevObjects.clear();
  objects.forEach(obj => state.prevObjects.set(obj.id, obj));
}

// --- Render Room ---

function renderRoom(objects) {
  // Clear existing cards, but we recreate them so we can animate naturally
  document.querySelectorAll('.room-card').forEach(el => el.remove());
  
  const frag = document.createDocumentFragment();
  
  objects.forEach(obj => {
    const prev = state.prevObjects.get(obj.id);
    const card = document.createElement('div');
    card.className = `room-card card-${obj.kind}`;
    card.id = `card-${obj.id}`;
    card.style.left = `${obj.position.x}%`;
    card.style.top = `${obj.position.y}%`;
    
    // Check animations
    if (prev) {
      if (prev.state.locked === true && obj.state.locked === false) card.classList.add('anim-unlock');
      if (prev.state.read === false && obj.state.read === true) card.classList.add('anim-clue-read');
      if (prev.state.open === false && obj.state.open === true && obj.kind === 'exit') card.classList.add('anim-exit-open');
    }
    
    // Maintain state styles if already true (e.g. clue already read past step)
    if (obj.kind === 'clue' && obj.state.read) card.classList.add('anim-clue-read');
    if (obj.kind === 'exit' && obj.state.open) card.classList.add('anim-exit-open');
    
    card.innerHTML = `
      <div class="room-card-header">
        <span>${obj.id}</span>
        <span class="room-card-badge badge-${obj.kind}">${obj.kind}</span>
      </div>
      <div class="room-card-body">
        ${formatState(obj.state)}
      </div>
    `;
    frag.appendChild(card);
  });
  
  DOM.roomCanvas.appendChild(frag);
  
  // Defer lines so DOM layout finishes
  setTimeout(() => drawRelations(objects), 10);
}

function formatState(s) {
  let lines = [];
  if (typeof s.locked === 'boolean') lines.push(`Lock: ${s.locked ? 'LOCKED' : 'UNLOCKED'}`);
  if (typeof s.open === 'boolean') lines.push(`Status: ${s.open ? 'OPEN' : 'CLOSED'}`);
  if (typeof s.read === 'boolean') lines.push(`Read: ${s.read ? 'YES' : 'NO'}`);
  if (s.contains?.length) lines.push(`Contains: ${s.contains.join(', ')}`);
  if (s.uses_key) lines.push(`Key needed: ${s.uses_key}`);
  if (s.needs_code) lines.push(`Code needed: ${s.needs_code}`);
  return lines.join('<br>') || 'No state tracked';
}

function drawRelations(objects) {
  DOM.relationLayer.innerHTML = '';
  objects.forEach(obj => {
    // Lock -> target
    if (obj.state.target) drawLine(obj.id, obj.state.target);
    
    // Clue reveals -> subject
    if (obj.kind === 'clue' && obj.state.reveals) {
      obj.state.reveals.forEach(rel => {
        if (rel.length === 3) drawLine(obj.id, rel[0]);
      });
    }
  });
}

function drawLine(fromId, toId) {
  const fromEl = document.getElementById(`card-${fromId}`);
  const toEl = document.getElementById(`card-${toId}`);
  if (!fromEl || !toEl) return;
  
  const fromRect = {
    x: fromEl.offsetLeft,
    y: fromEl.offsetTop
  };
  const toRect = {
    x: toEl.offsetLeft,
    y: toEl.offsetTop
  };
  
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', fromRect.x);
  line.setAttribute('y1', fromRect.y);
  line.setAttribute('x2', toRect.x);
  line.setAttribute('y2', toRect.y);
  DOM.relationLayer.appendChild(line);
}

function redrawLines() {
  if(state.prevObjects.size > 0) {
    drawRelations(Array.from(state.prevObjects.values()));
  }
}

// --- Render Mind ---

function renderObserved(facts) {
  if (facts.length < state.observedRendered) {
    DOM.observedList.innerHTML = '';
    state.observedRendered = 0;
  }
  for (let i = state.observedRendered; i < facts.length; i++) {
    const li = document.createElement('li');
    li.className = 'fact-item slide-in';
    li.textContent = `${facts[i].subject} ${facts[i].predicate} ${facts[i].object}`;
    DOM.observedList.appendChild(li);
  }
  state.observedRendered = facts.length;
  scrollToBottom(DOM.observedList);
}

function renderInferred(facts, objects) {
  if (facts.length < state.inferredRendered) {
    DOM.inferredList.innerHTML = '';
    state.inferredRendered = 0;
  }
  
  const newFacts = [];
  for (let i = state.inferredRendered; i < facts.length; i++) {
    const li = document.createElement('li');
    li.className = 'fact-item slide-in';
    li.innerHTML = `<span class="rule-badge">${facts[i].rule_name}</span>${facts[i].fact.subject} ${facts[i].fact.predicate} ${facts[i].fact.object}`;
    DOM.inferredList.appendChild(li);
    newFacts.push(facts[i]);
  }
  
  state.inferredRendered = facts.length;
  scrollToBottom(DOM.inferredList);
  
  if (newFacts.length > 0) {
    drawInferenceArcs(newFacts, objects);
  }
}

function drawInferenceArcs(newFacts, objects) {
  newFacts.forEach(factObj => {
    // Try to guess a source based on rule name.
    let sourceId = null;
    let targetId = factObj.fact.subject;
    
    // Simple heuristic to visually link arcs
    if (factObj.rule_name.includes('code_matches')) sourceId = 'clue_2'; 
    else if (factObj.rule_name.includes('key')) sourceId = 'key_red';
    else if (factObj.rule_name.includes('openable_with')) sourceId = targetId; 
    else if (factObj.rule_name.includes('reachable')) sourceId = 'lock_panel';
    else if (factObj.rule_name.includes('examined')) sourceId = targetId;
    
    // Draw an arc if we have source and target
    if (sourceId && targetId) {
       createSvgArc(sourceId, targetId, factObj.rule_name);
    } else {
       // fallback, loop onto itself
       createSvgArc(targetId, targetId, factObj.rule_name);
    }
  });
}

function createSvgArc(fromId, toId, ruleName) {
  const fromEl = document.getElementById(`card-${fromId}`);
  const toEl = document.getElementById(`card-${toId}`);
  if (!fromEl || !toEl) return;
  
  const from = { x: fromEl.offsetLeft, y: fromEl.offsetTop };
  const to = { x: toEl.offsetLeft, y: toEl.offsetTop };
  
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.className = 'inference-arc';
  
  let midX, midY;
  
  if (fromId === toId) {
    // Loop
    path.setAttribute('d', `M ${from.x-30} ${from.y} A 30 30 0 1 1 ${from.x+30} ${from.y}`);
    midX = from.x;
    midY = from.y - 45;
  } else {
    // Curve
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    midX = (from.x + to.x)/2 - dy/dist * 50; // curve offset
    midY = (from.y + to.y)/2 + dx/dist * 50;
    path.setAttribute('d', `M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`);
  }
  
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.className = 'inference-text';
  text.setAttribute('x', midX);
  text.setAttribute('y', midY);
  text.textContent = ruleName;
  
  DOM.inferenceLayer.appendChild(path);
  DOM.inferenceLayer.appendChild(text);
  
  setTimeout(() => {
    if (path.parentNode) path.remove();
    if (text.parentNode) text.remove();
  }, 2000);
}

function renderThisStep(payload, phase) {
  const actionObj = payload.action_taken || {action: "None", target: ""};
  const obs = payload.this_step.new_facts_from_perception.map(f => `${f.subject} ${f.predicate} ${f.object}`).join('; ');
  const inf = payload.this_step.new_facts_from_inference.map(f => `${f.subject} ${f.predicate} ${f.object}`).join('; ');
  const nextP = payload.next_planned_action || {action: "None", target: ""};
  
  DOM.thisStepContent.innerHTML = `
    <div class="phase-text">${phase}</div>
    <div><span class="action-highlight">Action Taken:</span> ${actionObj.action} ${actionObj.target}</div>
    <div><strong>New Perceptions:</strong> ${obs || 'None'}</div>
    <div><strong>New Inferences:</strong> ${inf || 'None'}</div>
    <div><strong>Next Plan:</strong> ${nextP.action} ${nextP.target}</div>
  `;
}

function renderHistory(payload) {
  if (payload.step === 0 || state.historyRendered.has(payload.step)) return;
  
  const actionObj = payload.action_taken || {action: "None", target: ""};
  const div = document.createElement('div');
  div.className = 'history-entry slide-in';
  div.innerHTML = `Step ${payload.step}: Agent performed <span>${actionObj.action} ${actionObj.target}</span>.`;
  
  DOM.historyStrip.appendChild(div);
  scrollToBottom(DOM.historyStrip);
  
  state.historyRendered.add(payload.step);
}

function scrollToBottom(el) {
  el.scrollTop = el.scrollHeight;
}

// --- Win State ---

function showWin(payload) {
  DOM.winSteps.textContent = payload.step;
  DOM.winFacts.textContent = payload.inferred_facts.length;
  DOM.winOverlay.classList.remove('hidden');
  stopAutoplay();
  DOM.toggleAutoplay.checked = false;
  burstConfetti();
}

function hideWin() {
  DOM.winOverlay.classList.add('hidden');
  DOM.confettiContainer.innerHTML = '';
}

function burstConfetti() {
  DOM.confettiContainer.innerHTML = '';
  const colors = ['#22c55e', '#a855f7', '#fb7185', '#14b8a6', '#f59e0b'];
  
  for (let i = 0; i < 150; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    p.style.left = `${Math.random() * 100}vw`;
    p.style.animationDuration = `${Math.random() * 2 + 1}s`;
    p.style.animationDelay = `${Math.random() * 0.5}s`;
    DOM.confettiContainer.appendChild(p);
  }
}

// Boot
init();
