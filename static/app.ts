// @ts-nocheck
export {};

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element;
}

const roomMap = requireElement("room-map");
const roomCanvas = requireElement("room-canvas");
const relationLayer = requireElement("relation-layer");
const inferenceLayer = requireElement("inference-layer");
const observedFactsList = requireElement("observed-facts");
const inferredFactsList = requireElement("inferred-facts");
const thisStepPanel = requireElement("this-step");
const historyStrip = requireElement("history-strip");
const stepButton = requireElement("step-btn");
const slowStepButton = requireElement("slow-step-btn");
const resetButton = requireElement("reset-btn");
const autoPlayToggle = requireElement("autoplay-toggle");
const highlightToggle = requireElement("highlight-toggle");
const speedSlider = requireElement("speed-slider");
const speedOutput = requireElement("speed-output");
const winOverlay = requireElement("win-overlay");
const winMeta = requireElement("win-meta");
const confettiLayer = requireElement("confetti-layer");

const appState = {
  socket: null,
  payload: null,
  previousObjects: new Map(),
  observedRenderCount: 0,
  inferredRenderCount: 0,
  seenNarrativeSteps: new Set(),
  autoplayHandle: null,
  autoplayDelayMs: Number(speedSlider.value),
  winStepShown: -1,
  pendingSlowStep: false,
  slowStepInFlight: false,
};

function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
  appState.socket = socket;

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    handlePayload(payload);
  });

  socket.addEventListener("close", () => {
    window.setTimeout(connectWebSocket, 1200);
  });
}

function handlePayload(payload) {
  const previousPayload = appState.payload;
  if (appState.payload) {
    appState.previousObjects = mapById(appState.payload.room.objects);
  }

  appState.payload = payload;

  if (payload.step === 0) {
    resetVisualState();
    render(payload);
    return;
  }

  if (
    appState.pendingSlowStep
    && !appState.slowStepInFlight
    && previousPayload
    && payload.step > previousPayload.step
  ) {
    appState.pendingSlowStep = false;
    void runSlowStepSequence(payload);
    return;
  }

  render(payload);
  addNarrativeIfNeeded(payload);
}

function render(payload) {
  renderRoom(payload.room.objects);
  renderObservedFacts(payload.observed_facts);
  const newInferredFacts = renderInferredFacts(payload.inferred_facts);
  animateInferenceHighlights(newInferredFacts, payload);
  renderThisStep(payload);
  renderWinState(payload);
}

function renderRoom(objects) {
  const fragment = document.createDocumentFragment();
  roomCanvas.querySelectorAll(".room-object").forEach((node) => node.remove());

  for (const object of objects) {
    const card = document.createElement("article");
    card.className = `room-object kind-${object.kind}`;
    card.style.left = `${object.position.x}%`;
    card.style.top = `${object.position.y}%`;

    const previous = appState.previousObjects.get(object.id);
    if (stateChanged(previous, object, "locked", true, false)) {
      card.classList.add("unlock-pulse");
    }
    if (object.kind === "clue" && stateChanged(previous, object, "read", false, true)) {
      card.classList.add("clue-read");
    }
    if (object.kind === "exit" && stateChanged(previous, object, "open", false, true)) {
      card.classList.add("exit-open");
    }

    const title = document.createElement("div");
    title.className = "object-title";
    const idSpan = document.createElement("span");
    idSpan.textContent = object.id;
    const badge = document.createElement("span");
    badge.className = "object-kind";
    badge.textContent = object.kind;
    title.append(idSpan, badge);

    const stateList = document.createElement("ul");
    stateList.className = "state-list";
    for (const item of summarizeState(object)) {
      const li = document.createElement("li");
      li.textContent = item;
      stateList.appendChild(li);
    }

    card.append(title, stateList);
    fragment.appendChild(card);
  }

  roomCanvas.appendChild(fragment);
  drawRelations(objects);
}

function summarizeState(object) {
  const lines = [];
  const state = object.state;

  if (typeof state.locked === "boolean") {
    lines.push(`lock: ${state.locked ? "locked" : "unlocked"}`);
  }
  if (typeof state.open === "boolean") {
    lines.push(`open: ${state.open ? "yes" : "no"}`);
  }
  if (typeof state.read === "boolean") {
    lines.push(`read: ${state.read ? "yes" : "no"}`);
  }
  if (Array.isArray(state.contains) && state.contains.length > 0) {
    lines.push(`contains: ${state.contains.join(", ")}`);
  }
  if (typeof state.target === "string") {
    lines.push(`target: ${state.target}`);
  }
  if (typeof state.uses_key === "string") {
    lines.push(`key: ${state.uses_key}`);
  }
  if (typeof state.needs_code === "string") {
    lines.push(`code: ${state.needs_code}`);
  }
  if (Array.isArray(state.requires) && state.requires.length > 0) {
    lines.push(`requires: ${state.requires.join(", ")}`);
  }
  if (Array.isArray(state.reveals) && state.reveals.length > 0) {
    lines.push(`reveals: ${state.reveals.length} fact(s)`);
  }

  if (lines.length === 0) {
    lines.push("no tracked state");
  }

  return lines;
}

function drawRelations(objects) {
  relationLayer.innerHTML = "";
  const objectMap = mapById(objects);
  const width = roomCanvas.clientWidth;
  const height = roomCanvas.clientHeight;

  const relations = [];
  for (const object of objects) {
    if (typeof object.state.target === "string" && objectMap.has(object.state.target)) {
      relations.push({ from: object.id, to: object.state.target });
    }

    if (object.kind === "clue" && Array.isArray(object.state.reveals)) {
      for (const relation of object.state.reveals) {
        if (!Array.isArray(relation) || relation.length !== 3) {
          continue;
        }
        const subject = String(relation[0]);
        if (objectMap.has(subject)) {
          relations.push({ from: object.id, to: subject });
        }
      }
    }
  }

  for (const relation of relations) {
    const from = objectMap.get(relation.from);
    const to = objectMap.get(relation.to);
    if (!from || !to) {
      continue;
    }

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.classList.add("relation-line");
    line.setAttribute("x1", String((from.position.x / 100) * width));
    line.setAttribute("y1", String((from.position.y / 100) * height));
    line.setAttribute("x2", String((to.position.x / 100) * width));
    line.setAttribute("y2", String((to.position.y / 100) * height));
    relationLayer.appendChild(line);
  }
}

function animateInferenceHighlights(newInferredFacts, payload) {
  if (!highlightToggle.checked || newInferredFacts.length === 0) {
    return;
  }

  const objectMap = mapById(payload.room.objects);
  const allFacts = payload.observed_facts.concat(payload.inferred_facts.map((item) => item.fact));

  for (const inferred of newInferredFacts) {
    const arcs = deriveInferenceArcs(inferred, allFacts);
    if (arcs.length === 0) {
      continue;
    }
    for (const arc of arcs) {
      drawInferenceArc(objectMap, arc.from, arc.to, inferred.rule_name);
    }
  }
}

function deriveInferenceArcs(inferred, allFacts) {
  const arcs = [];
  const fact = inferred.fact;

  if (inferred.rule_name === "panel_can_be_opened_when_code_matches") {
    const panelNeedsCode = allFacts.find(
      (item) => item.subject === fact.subject && item.predicate === "needs_code",
    );
    if (!panelNeedsCode) {
      return arcs;
    }
    const clueCodeFact = allFacts.find(
      (item) => item.predicate === "says_code" && item.object === panelNeedsCode.object,
    );
    if (clueCodeFact) {
      arcs.push({ from: clueCodeFact.subject, to: fact.subject });
    }
    return arcs;
  }

  if (inferred.rule_name === "clue_available_when_container_open") {
    const container = allFacts.find(
      (item) => item.predicate === "contains" && item.object === fact.subject,
    );
    if (container) {
      arcs.push({ from: container.subject, to: fact.subject });
    }
    return arcs;
  }

  if (inferred.rule_name === "lock_openable_with_available_key") {
    const lockUsesKey = allFacts.find(
      (item) => item.subject === fact.subject && item.predicate === "uses_key",
    );
    if (lockUsesKey) {
      arcs.push({ from: lockUsesKey.object, to: fact.subject });
    }
    return arcs;
  }

  if (inferred.rule_name === "exit_reachable_when_required_lock_open") {
    const requiredLock = allFacts.find(
      (item) => item.subject === fact.subject && item.predicate === "requires_lock",
    );
    if (requiredLock) {
      arcs.push({ from: requiredLock.object, to: fact.subject });
    }
    return arcs;
  }

  if (inferred.rule_name === "available_unread_clue_should_be_examined") {
    arcs.push({ from: fact.subject, to: fact.subject });
    return arcs;
  }

  return arcs;
}

function drawInferenceArc(objectMap, fromId, toId, ruleName) {
  const fromObject = objectMap.get(fromId);
  const toObject = objectMap.get(toId);
  if (!fromObject || !toObject) {
    return;
  }

  const width = roomCanvas.clientWidth;
  const height = roomCanvas.clientHeight;
  const from = roomCenter(fromObject, width, height);
  const to = roomCenter(toObject, width, height);

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.classList.add("inference-arc-path");

  let labelX = from.x;
  let labelY = from.y - 14;

  if (fromId === toId) {
    const radius = 26;
    path.setAttribute(
      "d",
      `M ${from.x - radius} ${from.y} A ${radius} ${radius} 0 1 1 ${from.x + radius} ${from.y}`,
    );
  } else {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const normalX = -dy / length;
    const normalY = dx / length;
    const bend = Math.min(74, 24 + length * 0.13);
    const controlX = (from.x + to.x) / 2 + normalX * bend;
    const controlY = (from.y + to.y) / 2 + normalY * bend;
    labelX = controlX;
    labelY = controlY - 10;
    path.setAttribute("d", `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}`);
  }

  const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label.classList.add("inference-arc-label");
  label.setAttribute("x", String(labelX));
  label.setAttribute("y", String(labelY));
  label.textContent = ruleName;

  inferenceLayer.append(path, label);
  window.setTimeout(() => {
    path.remove();
    label.remove();
  }, 2000);
}

function roomCenter(object, width, height) {
  return {
    x: (object.position.x / 100) * width,
    y: (object.position.y / 100) * height,
  };
}

function renderObservedFacts(facts) {
  if (facts.length < appState.observedRenderCount) {
    observedFactsList.innerHTML = "";
    appState.observedRenderCount = 0;
  }

  while (appState.observedRenderCount < facts.length) {
    const fact = facts[appState.observedRenderCount];
    const item = document.createElement("li");
    item.className = "fact-item slide-in";
    item.textContent = factSentence(fact);
    observedFactsList.appendChild(item);
    appState.observedRenderCount += 1;
  }
}

function renderInferredFacts(facts) {
  const newInferred = [];

  if (facts.length < appState.inferredRenderCount) {
    inferredFactsList.innerHTML = "";
    appState.inferredRenderCount = 0;
  }

  while (appState.inferredRenderCount < facts.length) {
    const inferred = facts[appState.inferredRenderCount];
    const item = document.createElement("li");
    item.className = "fact-item slide-in";
    item.textContent = `${inferred.rule_name}: ${factSentence(inferred.fact)}`;
    inferredFactsList.appendChild(item);
    newInferred.push(inferred);
    appState.inferredRenderCount += 1;
  }

  return newInferred;
}

function renderThisStep(payload, phaseLabel = null) {
  const actionText = payload.action_taken
    ? `${payload.action_taken.action} ${payload.action_taken.target}`
    : "none";
  const nextText = payload.next_planned_action
    ? `${payload.next_planned_action.action} ${payload.next_planned_action.target}`
    : "none";

  const observed = payload.this_step.new_facts_from_perception.map(factSentence).join("; ");
  const inferred = payload.this_step.new_facts_from_inference.map(factSentence).join("; ");

  thisStepPanel.innerHTML = "";

  const lines = [
    `Phase: ${phaseLabel || "Complete"}`,
    `Action taken: ${actionText}`,
    `New observed facts: ${observed || "none"}`,
    `New inferred facts: ${inferred || "none"}`,
    `Next plan: ${nextText}`,
  ];

  for (const lineText of lines) {
    const line = document.createElement("p");
    line.className = "slide-in";
    line.textContent = lineText;
    thisStepPanel.appendChild(line);
  }
}

function renderWinState(payload) {
  if (!payload.game_won) {
    return;
  }
  winOverlay.classList.remove("hidden");
  winMeta.textContent = `Escaped in ${payload.step} steps with ${payload.inferred_facts.length} inferred facts.`;
  if (appState.winStepShown !== payload.step) {
    burstConfetti();
    appState.winStepShown = payload.step;
  }
}

function hideWinOverlay() {
  winOverlay.classList.add("hidden");
  confettiLayer.innerHTML = "";
  inferenceLayer.innerHTML = "";
  appState.winStepShown = -1;
}

function burstConfetti() {
  confettiLayer.innerHTML = "";
  const colors = ["#f7be4e", "#1ab59a", "#ffffff", "#ff7b4d", "#6fd26f"];

  for (let i = 0; i < 90; i += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 300}ms`;
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    confettiLayer.appendChild(piece);
  }
}

function addNarrativeIfNeeded(payload) {
  if (payload.step <= 0 || appState.seenNarrativeSteps.has(payload.step)) {
    return;
  }

  appState.seenNarrativeSteps.add(payload.step);

  const action = payload.action_taken
    ? `${payload.action_taken.action} ${payload.action_taken.target}`
    : "waited";
  const learned = payload.this_step.new_facts_from_perception
    .slice(0, 2)
    .map(factSentence)
    .join("; ");
  const inferred = payload.this_step.new_facts_from_inference
    .slice(0, 2)
    .map(factSentence)
    .join("; ");

  const entry = document.createElement("p");
  entry.className = "history-entry slide-in";
  entry.textContent = `Step ${payload.step} - ${action}. Learned: ${learned || "none"}. Inferred: ${inferred || "none"}.`;
  historyStrip.appendChild(entry);
  historyStrip.scrollTop = historyStrip.scrollHeight;
}

function mapById(objects) {
  return new Map(objects.map((object) => [object.id, object]));
}

function stateChanged(previous, current, key, fromValue, toValue) {
  if (!previous) {
    return false;
  }
  return previous.state[key] === fromValue && current.state[key] === toValue;
}

function factSentence(fact) {
  return `${fact.subject} ${fact.predicate} ${fact.object}`;
}

function sendCommand(command) {
  const socket = appState.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify({ command }));
}

function resetVisualState() {
  appState.observedRenderCount = 0;
  appState.inferredRenderCount = 0;
  appState.seenNarrativeSteps.clear();
  appState.pendingSlowStep = false;
  appState.slowStepInFlight = false;
  historyStrip.innerHTML = "";
  observedFactsList.innerHTML = "";
  inferredFactsList.innerHTML = "";
  hideWinOverlay();
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function runSlowStepSequence(payload) {
  if (appState.slowStepInFlight) {
    return;
  }

  appState.slowStepInFlight = true;
  renderRoom(payload.room.objects);

  renderThisStep(payload, "Perceiving...");
  await delay(600);

  renderObservedFacts(payload.observed_facts);
  renderThisStep(payload, "Inferring...");
  await delay(600);

  const newInferredFacts = renderInferredFacts(payload.inferred_facts);
  animateInferenceHighlights(newInferredFacts, payload);
  renderThisStep(payload, "Planning...");
  await delay(600);

  renderThisStep(payload, "Acting...");
  renderWinState(payload);
  addNarrativeIfNeeded(payload);
  appState.slowStepInFlight = false;
}

function configureControls() {
  stepButton.addEventListener("click", () => {
    if (appState.slowStepInFlight) {
      return;
    }
    sendCommand("step");
  });

  slowStepButton.addEventListener("click", () => {
    if (appState.slowStepInFlight) {
      return;
    }
    stopAutoplay();
    autoPlayToggle.checked = false;
    appState.pendingSlowStep = true;
    sendCommand("step");
  });

  resetButton.addEventListener("click", () => {
    stopAutoplay();
    autoPlayToggle.checked = false;
    appState.pendingSlowStep = false;
    appState.slowStepInFlight = false;
    sendCommand("reset");
  });

  autoPlayToggle.addEventListener("change", () => {
    if (autoPlayToggle.checked) {
      startAutoplay();
      return;
    }
    stopAutoplay();
  });

  speedSlider.addEventListener("input", () => {
    appState.autoplayDelayMs = Number(speedSlider.value);
    speedOutput.value = `${appState.autoplayDelayMs}ms`;
    if (autoPlayToggle.checked) {
      startAutoplay();
    }
  });

  speedOutput.value = `${appState.autoplayDelayMs}ms`;
}

function startAutoplay() {
  stopAutoplay();
  appState.autoplayHandle = window.setInterval(() => {
    if (appState.payload?.game_won) {
      stopAutoplay();
      autoPlayToggle.checked = false;
      return;
    }
    if (appState.slowStepInFlight) {
      return;
    }
    sendCommand("step");
  }, appState.autoplayDelayMs);
}

function stopAutoplay() {
  if (appState.autoplayHandle !== null) {
    window.clearInterval(appState.autoplayHandle);
    appState.autoplayHandle = null;
  }
}

configureControls();
connectWebSocket();
window.addEventListener("resize", () => {
  if (appState.payload) {
    drawRelations(appState.payload.room.objects);
  }
});
