function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function sameEndpoint(left, right) {
  return left?.componentId === right?.componentId && left?.sourceId === right?.sourceId && left?.portId === right?.portId;
}

export function createPolicyInspector(component, { onTrace, onApply }) {
  const view = component.policyView;
  const section = element("section", null, "policy-inspector inspector-section");
  const choices = [...(view?.available ?? []), ...(view?.availableRoles ?? [])];
  section.append(element("h3", view?.role ? "Physical role" : "Policy"));
  if (!choices.length) {
    section.append(element("p", "Operation follows the component equations."));
    return section;
  }
  const active = view.role ?? view.definition;
  section.append(element("p", active?.name ?? "No policy selected", view.role ? "role-name" : "policy-name"));
  if (active) section.append(element("p", active.explanation.summary));
  if (view.role && view.requestSources.length) {
    const sources = element("dl", null, "inspector-fields role-request-sources");
    const row = element("div");
    row.append(element("dt", "Power requested by"), element("dd", view.requestSources.map(({ name }) => name).join(", ")));
    sources.append(row); section.append(sources);
  }
  const list = element("ul", null, "policy-inputs");
  for (const connection of view.connections) {
    const item = element("li");
    const button = element("button", null, "policy-input-link");
    button.type = "button";
    button.dataset.informationConnectionId = connection.id;
    button.append(element("strong", connection.label), element("span", connection.sourceLabel));
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      for (const input of list.querySelectorAll("button")) input.setAttribute("aria-pressed", String(input === button));
      onTrace(connection.id);
    });
    item.append(button); list.append(item);
  }
  section.append(list);
  const edit = element("details", null, "policy-editor");
  edit.append(element("summary", view.availableRoles.length ? "Change operation" : "Edit policy and inputs"));
  const form = element("form");
  const selectorName = view.availableRoles.length ? "Operation" : "Policy";
  const selectorLabel = element("label", selectorName);
  const selector = element("select");
  selector.setAttribute("aria-label", selectorName);
  for (const [label, definitions] of [["Operating policies", view.available], ["Physical roles", view.availableRoles]]) {
    if (!definitions.length) continue;
    const group = element("optgroup"); group.label = label;
    for (const definition of definitions) {
      const option = element("option", definition.name); option.value = definition.type;
      group.append(option);
    }
    selector.append(group);
  }
  selector.value = view.configuration?.type ?? choices[0].type;
  selectorLabel.append(selector); form.append(selectorLabel);
  const fields = element("div", null, "policy-editor-fields");
  const error = element("p", null, "policy-error"); error.setAttribute("role", "alert");
  const apply = element("button", "Apply policy", "secondary-button"); apply.type = "submit";
  let definition, inputs, settings;
  function rebuild() {
    definition = choices.find(({ type }) => type === selector.value);
    apply.textContent = definition.role ? "Apply role" : "Apply policy";
    fields.replaceChildren(); inputs = new Map(); settings = new Map(); error.textContent = "";
    for (const [id, spec] of Object.entries(definition.settings)) {
      const label = element("label", `${spec.label}${spec.unit === "1" ? "" : ` (${spec.unit})`}`);
      const control = element(spec.choices ? "select" : "input");
      control.setAttribute("aria-label", spec.label);
      if (spec.choices) {
        for (const choice of spec.choices) { const option = element("option", choice.label); option.value = String(choice.value); control.append(option); }
      } else {
        control.type = "number"; control.step = "any"; control.required = true;
        if (spec.minimum !== undefined) control.min = spec.minimum;
        if (spec.maximum !== undefined) control.max = spec.maximum;
      }
      control.value = String(definition.type === view.configuration?.type ? view.settings[id] : spec.default);
      settings.set(id, control); label.append(control); fields.append(label);
    }
    for (const [id, spec] of Object.entries(definition.inputs)) {
      const label = element("label", spec.label);
      const select = element("select"); select.required = true;
      select.setAttribute("aria-label", `${spec.label} source`);
      const empty = element("option", "Choose an information source"); empty.value = ""; select.append(empty);
      const options = view.optionsFor(spec);
      options.forEach((candidate, index) => { const option = element("option", candidate.label); option.value = String(index); select.append(option); });
      const existing = view.connections.find(({ to }) => to.portId === `policy.${id}`);
      const index = options.findIndex(({ from }) => sameEndpoint(from, existing?.from));
      select.value = index >= 0 ? String(index) : "";
      inputs.set(id, { select, options }); label.append(select); fields.append(label);
    }
  }
  selector.addEventListener("change", rebuild); rebuild();
  form.append(fields, error, apply);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const sources = new Map(view.sources.map((source) => [source.id, source]));
    const connections = [...inputs].map(([id, { select, options }]) => {
      const chosen = options[Number(select.value)];
      if (chosen.source) sources.set(chosen.source.id, chosen.source);
      return { id: `info-policy-${component.id}-${id}`, name: definition.inputs[id].label,
        from: chosen.from, to: { componentId: component.id, portId: `policy.${id}` } };
    });
    const result = onApply({ componentId: component.id,
      policy: { type: definition.type, settings: Object.fromEntries([...settings].map(([id, control]) => [id, Number(control.value)])) },
      informationConnections: connections, informationSources: [...sources.values()] });
    error.textContent = result?.error ?? "";
    if (!result?.error) edit.open = false;
  });
  edit.append(form); section.append(edit);
  return section;
}
