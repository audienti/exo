const signalData = [
  {
    title: "Wintrust executive change",
    account: "Actico / Wintrust",
    summary: "Chief Compliance Officer changed roles 19 days ago and is now publicly talking about consistency across a federated model.",
    evidence: [
      "Recent role transition indicates a new mandate window.",
      "Public remarks emphasize consistency, control, and simplification.",
      "Account profile matches Actico's strongest decisioning and compliance posture."
    ],
    prediction: "If we send a signal-tied opener now, we expect profile engagement or a reply within 7 days.",
    confidence: "Moderate",
    horizon: "7 days",
    nextStep: "Open review item for LinkedIn opener framed around consistency across multiple charters."
  },
  {
    title: "Return traffic after outreach",
    account: "Knit / Cluster A",
    summary: "Target account revisited product material twice after prior contact but has not replied.",
    evidence: [
      "Repeat visit indicates active curiosity but uncertain urgency.",
      "No explicit reply means context may still be weak.",
      "Follow-up should sharpen hypothesis rather than push volume."
    ],
    prediction: "A narrow follow-up tied to the prior note may trigger engagement, but only if the message reduces ambiguity.",
    confidence: "Low to moderate",
    horizon: "5 days",
    nextStep: "Refresh account brief before any follow-up is proposed."
  },
  {
    title: "AML modernization hiring",
    account: "Actico / Valley National",
    summary: "Open role suggests program buildout, but timing may still be too early for direct outreach.",
    evidence: [
      "Hiring indicates initiative formation, not necessarily active vendor evaluation.",
      "Signal is real but may overstate immediacy.",
      "A no-action recommendation may be more correct than forced outreach."
    ],
    prediction: "No action now is more likely to preserve quality than an opportunistic message.",
    confidence: "Moderate",
    horizon: "14 days",
    nextStep: "Watch for second corroborating signal before sending."
  },
  {
    title: "Off-platform LinkedIn reply",
    account: "Legacy thread / Manual drift",
    summary: "Operator replied directly in LinkedIn. Exo repaired the thread state and closed the pending proposal.",
    evidence: [
      "Observed thread state diverged from expected Exo workflow.",
      "Manual response created ambiguity about next owner.",
      "Reconciliation was successful, but human takeover is still needed."
    ],
    prediction: "Operator should take ownership directly; automated follow-up would be inappropriate.",
    confidence: "High",
    horizon: "Immediate",
    nextStep: "Assign human takeover and record revised prediction in history."
  }
];

const proposalData = [
  {
    title: "LinkedIn opener / Wintrust",
    target: "Jacqueline Adams",
    trigger: "Executive change + compliance consistency signal",
    draft: "Jacqueline, your comments on maintaining consistency across a federated operating model stood out. That kind of mandate usually surfaces the limits of rules, decision traceability, and exception handling faster than people admit. Thought it might be useful to compare notes with what we see in similar remediation-heavy environments.",
    prediction: "Profile engagement or written reply within 7 days.",
    confidence: "Moderate",
    horizon: "7 days",
    rationale: "Signal timing is real, message is specific, and account pain is operational rather than generic automation.",
    policy: "Safe to send / human-reviewed"
  },
  {
    title: "Email follow-up / Valley National",
    target: "Program architecture stakeholder",
    trigger: "Single AML modernization hiring signal",
    draft: "Saw the AML modernization hiring signal. Curious whether the initiative is already tied to decisioning and explainability work or still in staffing mode.",
    prediction: "Low chance of meaningful response; likely premature.",
    confidence: "Low",
    horizon: "10 days",
    rationale: "Signal may indicate eventual fit but does not yet justify assertive outreach.",
    policy: "Recommend defer / no-action"
  },
  {
    title: "Manual takeover / Drifted thread",
    target: "Existing LinkedIn contact",
    trigger: "Observed manual reply outside Exo",
    draft: "No new drafted action. Recommend closing machine-driven workflow and handing thread to operator.",
    prediction: "Human handling preserves context and avoids conflicting messages.",
    confidence: "High",
    horizon: "Immediate",
    rationale: "Observed reality already invalidated the pending machine proposal.",
    policy: "Human takeover required"
  }
];

const replyData = [
  {
    title: "Wintrust / Profile engagement",
    thread: [
      "Outbound note sent 09:14",
      "Profile viewed 11:38",
      "No written reply yet"
    ],
    classification: "Positive signal, not yet full response",
    nextStep: "Wait 48 hours, then consider a second message only if no further activity occurs.",
    predictionCheck: "Prediction is directionally useful. Timing was stronger than expected, but response depth is still unconfirmed.",
    crm: "Log profile engagement and keep thread in monitored state."
  },
  {
    title: "Manual LinkedIn reply / Reconciled",
    thread: [
      "Pending Exo proposal was still open",
      "Operator replied manually in LinkedIn",
      "Audit observed thread update and repaired state"
    ],
    classification: "Human takeover",
    nextStep: "Keep Exo monitoring but stop generating automatic follow-up.",
    predictionCheck: "Original automated path is no longer valid; reconciliation prevented a duplicate move.",
    crm: "Record manual response and handoff status."
  }
];

const signalDetail = document.getElementById("signal-detail");
const proposalDetail = document.getElementById("proposal-detail");
const replyDetail = document.getElementById("reply-detail");
const titleNode = document.getElementById("view-title");

function renderSignal(index) {
  const item = signalData[index];
  signalDetail.innerHTML = `
    <div class="detail-stack">
      <div>
        <span class="label">Signal detail</span>
        <h4>${item.title}</h4>
        <p>${item.summary}</p>
      </div>
      <div class="metric-grid">
        <div class="metric-card">
          <span class="label">Prediction</span>
          <strong>${item.prediction}</strong>
        </div>
        <div class="metric-card">
          <span class="label">Confidence</span>
          <strong>${item.confidence}</strong>
        </div>
        <div class="metric-card">
          <span class="label">Time horizon</span>
          <strong>${item.horizon}</strong>
        </div>
      </div>
      <div class="info-block">
        <span class="label">Evidence</span>
        <ul>${item.evidence.map((point) => `<li>${point}</li>`).join("")}</ul>
      </div>
      <div class="info-block">
        <span class="label">Recommended next step</span>
        <p>${item.nextStep}</p>
        <div class="action-row">
          <button class="primary-button" data-view-jump="review">Request action proposal</button>
          <button class="secondary-button" data-view-jump="account">Update account brief</button>
          <button class="ghost-button">Snooze</button>
        </div>
      </div>
    </div>
  `;
}

function renderProposal(index) {
  const item = proposalData[index];
  proposalDetail.innerHTML = `
    <div class="detail-stack">
      <div>
        <span class="label">Proposal</span>
        <h4>${item.title}</h4>
        <p>Target: ${item.target}</p>
      </div>
      <div class="metric-grid">
        <div class="metric-card">
          <span class="label">Predicted outcome</span>
          <strong>${item.prediction}</strong>
        </div>
        <div class="metric-card">
          <span class="label">Confidence</span>
          <strong>${item.confidence}</strong>
        </div>
        <div class="metric-card">
          <span class="label">Time horizon</span>
          <strong>${item.horizon}</strong>
        </div>
      </div>
      <div class="info-block">
        <span class="label">Why now</span>
        <p>${item.trigger}</p>
      </div>
      <div class="info-block">
        <span class="label">Draft</span>
        <p>${item.draft}</p>
      </div>
      <div class="info-block">
        <span class="label">Rationale and policy</span>
        <p>${item.rationale}</p>
        <p style="margin-top:10px;"><strong>${item.policy}</strong></p>
      </div>
      <div class="control-actions">
        <button class="primary-button">Approve</button>
        <button class="secondary-button">Edit + approve</button>
        <button class="ghost-button">Reject</button>
        <button class="ghost-button">Assign takeover</button>
      </div>
    </div>
  `;
}

function renderReply(index) {
  const item = replyData[index];
  replyDetail.innerHTML = `
    <div class="detail-stack">
      <div>
        <span class="label">Observed outcome</span>
        <h4>${item.title}</h4>
      </div>
      <div class="info-block">
        <span class="label">Thread</span>
        <ul>${item.thread.map((line) => `<li>${line}</li>`).join("")}</ul>
      </div>
      <div class="info-block">
        <span class="label">Classification</span>
        <p>${item.classification}</p>
      </div>
      <div class="info-block">
        <span class="label">Next move</span>
        <p>${item.nextStep}</p>
      </div>
      <div class="info-block">
        <span class="label">Prediction check</span>
        <p>${item.predictionCheck}</p>
      </div>
      <div class="info-block">
        <span class="label">CRM commit</span>
        <p>${item.crm}</p>
      </div>
      <div class="control-actions">
        <button class="primary-button">Accept next step</button>
        <button class="secondary-button">Rewrite response</button>
        <button class="ghost-button">Create follow-up task</button>
      </div>
    </div>
  `;
}

function setActiveView(view) {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.viewPanel === view);
  });
  const activeButton = document.querySelector(`.nav-item[data-view="${view}"] span`);
  if (activeButton) titleNode.textContent = activeButton.textContent;
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setActiveView(button.dataset.view));
});

document.addEventListener("click", (event) => {
  const jumpTarget = event.target.closest("[data-view-jump]");
  if (jumpTarget) {
    setActiveView(jumpTarget.dataset.viewJump);
  }
});

document.querySelectorAll(".signal-row").forEach((button, index) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".signal-row").forEach((row) => row.classList.remove("is-selected"));
    button.classList.add("is-selected");
    renderSignal(index);
  });
});

document.querySelectorAll(".proposal-row").forEach((button, index) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".proposal-row").forEach((row) => row.classList.remove("is-selected"));
    button.classList.add("is-selected");
    renderProposal(index);
  });
});

document.querySelectorAll(".reply-row").forEach((button, index) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".reply-row").forEach((row) => row.classList.remove("is-selected"));
    button.classList.add("is-selected");
    renderReply(index);
  });
});

renderSignal(0);
renderProposal(0);
renderReply(0);
