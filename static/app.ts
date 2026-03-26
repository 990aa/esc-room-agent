export {};

type Fact = {
  subject: string;
  predicate: string;
  object: string;
};

type InferredFact = {
  rule_name: string;
  fact: Fact;
};

type RoomObject = {
  id: string;
  kind: "drawer" | "panel" | "clue" | "lock" | "exit";
  state: Record<string, unknown>;
  position: { x: number; y: number };
};

type RoomSnapshot = {
  objects: RoomObject[];
};

type Action = {
  action: string;
  target: string;
  code?: string;
};

type StepPayload = {
  room: RoomSnapshot;
  observed_facts: Fact[];
  inferred_facts: InferredFact[];
  action_taken: Action | null;
  next_planned_action: Action | null;
  game_won: boolean;
  step: number;
  this_step: {
    new_facts_from_perception: Fact[];
    new_facts_from_inference: Fact[];
  };
};

const roomMap = document.getElementById("room-map") as HTMLDivElement;
const relationLayerNode = document.getElementById("relation-layer");
if (!(relationLayerNode instanceof SVGSVGElement)) {
  throw new Error("Missing relation-layer SVG element");
}
const relationLayer = relationLayerNode;
const observedFactsList = document.getElementById("observed-facts") as HTMLUListElement;
const inferredFactsList = document.getElementById("inferred-facts") as HTMLUListElement;
const thisStepPanel = document.getElementById("this-step") as HTMLDivElement;
const historyStrip = document.getElementById("history-strip") as HTMLDivElement;
const stepButton = document.getElementById("step-btn") as HTMLButtonElement;
const resetButton = document.getElementById("reset-btn") as HTMLButtonElement;
const autoPlayToggle = document.getElementById("autoplay-toggle") as HTMLInputElement;
const speedSlider = document.getElementById("speed-slider") as HTMLInputElement;
const speedOutput = document.getElementById("speed-output") as HTMLOutputElement;
const winOverlay = document.getElementById("win-overlay") as HTMLDivElement;
const winMeta = document.getElementById("win-meta") as HTMLParagraphElement;
const confettiLayer = document.getElementById("confetti-layer") as HTMLDivElement;

const appState: {
  socket: WebSocket | null;
  payload: StepPayload | null;
  previousObjects: Map<string, RoomObject>;
  observedRenderCount: number;
  inferredRenderCount: number;
  seenNarrativeSteps: Set<number>;
  autoplayHandle: number | null;
  autoplayDelayMs: number;
  winStepShown: number;
} = {
  socket: null,
  payload: null,
  previousObjects: new Map<string, RoomObject>(),
  observedRenderCount: 0,
  inferredRenderCount: 0,
  seenNarrativeSteps: new Set<number>(),
  autoplayHandle: null,
  autoplayDelayMs: Number(speedSlider.value),
  winStepShown: -1,
};

function connectWebSocket(): void {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
  appState.socket = socket;

  socket.addEventListener("message", (event: MessageEvent<string>) => {
    const payload = JSON.parse(event.data) as StepPayload;
    handlePayload(payload);
  });

  socket.addEventListener("close", () => {
    window.setTimeout(connectWebSocket, 1200);
  });
}

function handlePayload(payload: StepPayload): void {
  if (appState.payload) {
    appState.previousObjects = mapById(appState.payload.room.objects);
  }

  appState.payload = payload;

  if (payload.step === 0) {
    appState.observedRenderCount = 0;
    appState.inferredRenderCount = 0;
    appState.seenNarrativeSteps.clear();
    historyStrip.innerHTML = "";
    hideWinOverlay();
  }

  render(payload);
  addNarrativeIfNeeded(payload);
}

function render(payload: StepPayload): void {
  renderRoom(payload.room.objects);
  renderObservedFacts(payload.observed_facts);
  renderInferredFacts(payload.inferred_facts);
  renderThisStep(payload);
  renderWinState(payload);
}

function renderRoom(objects: RoomObject[]): void {
  const fragment = document.createDocumentFragment();
  roomMap.querySelectorAll(".room-object").forEach((node) => node.remove());

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

  roomMap.appendChild(fragment);
  drawRelations(objects);
}

function summarizeState(object: RoomObject): string[] {
  const lines: string[] = [];
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

function drawRelations(objects: RoomObject[]): void {
  relationLayer.innerHTML = "";
  const objectMap = mapById(objects);
  const width = roomMap.clientWidth;
  const height = roomMap.clientHeight;

  const relations: Array<{ from: string; to: string }> = [];
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

function renderObservedFacts(facts: Fact[]): void {
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

function renderInferredFacts(facts: InferredFact[]): void {
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
    appState.inferredRenderCount += 1;
  }
}

function renderThisStep(payload: StepPayload): void {
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

function renderWinState(payload: StepPayload): void {
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

function hideWinOverlay(): void {
  winOverlay.classList.add("hidden");
  confettiLayer.innerHTML = "";
  appState.winStepShown = -1;
}

function burstConfetti(): void {
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

function addNarrativeIfNeeded(payload: StepPayload): void {
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

function mapById(objects: RoomObject[]): Map<string, RoomObject> {
  return new Map(objects.map((object) => [object.id, object]));
}

function stateChanged(
  previous: RoomObject | undefined,
  current: RoomObject,
  key: string,
  fromValue: unknown,
  toValue: unknown,
): boolean {
  if (!previous) {
    return false;
  }
  return previous.state[key] === fromValue && current.state[key] === toValue;
}

function factSentence(fact: Fact): string {
  return `${fact.subject} ${fact.predicate} ${fact.object}`;
}

function sendCommand(command: "step" | "reset"): void {
  const socket = appState.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify({ command }));
}

function configureControls(): void {
  stepButton.addEventListener("click", () => {
    sendCommand("step");
  });

  resetButton.addEventListener("click", () => {
    stopAutoplay();
    autoPlayToggle.checked = false;
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

function startAutoplay(): void {
  stopAutoplay();
  appState.autoplayHandle = window.setInterval(() => {
    if (appState.payload?.game_won) {
      stopAutoplay();
      autoPlayToggle.checked = false;
      return;
    }
    sendCommand("step");
  }, appState.autoplayDelayMs);
}

function stopAutoplay(): void {
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
