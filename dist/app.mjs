import {
  configured,
  signedIn,
  login,
  signup,
  logout,
  recover,
  changePassword,
  handleCallback,
  rpc,
  invokeFunction,
} from "./api.mjs";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const money = (v) => "₹" + Number(v).toLocaleString("en-IN"),
  date = (d) =>
    new Date(d + "T12:00:00").toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
    }),
  today = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  tag = (s) =>
    `<span class="tag ${esc(s)}">${esc(s.replaceAll("_", " "))}</span>`;
let state = null,
  page = "overview",
  filter = "all",
  times = [],
  draft = { date: today(), time: "", instructor: "", vehicle: "" },
  busy = false,
  recovery = handleCallback();
const role = () => state?.me.role,
  who = (id) =>
    esc(state.instructors.find((i) => i.id === id)?.name || "Instructor"),
  car = (id) => state.vehicles.find((v) => v.id === id),
  initials = (n) =>
    esc(
      n
        .split(" ")
        .map((x) => x[0])
        .slice(0, 2)
        .join("")
        .toUpperCase(),
    );
const navs = {
  student: [
    ["overview", "Overview"],
    ["book", "Book a lesson"],
    ["lessons", "My lessons"],
    ["progress", "My progress"],
    ["payments", "Payments"],
  ],
  instructor: [
    ["overview", "Overview"],
    ["lessons", "My schedule"],
    ["progress", "Assessments"],
  ],
  admin: [
    ["overview", "Overview"],
    ["lessons", "All bookings"],
    ["team", "Instructors"],
    ["fleet", "Vehicles"],
    ["payments", "Payments"],
  ],
};
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("#toast").style.display = "none"), 5500);
}
function modal(title, body) {
  const m = $("#modal");
  m.innerHTML = `<div class="modal-top"><h2 id="modal-title">${title}</h2><button class="close" aria-label="Close dialog">×</button></div>${body}`;
  m.querySelector(".close").onclick = () => m.close();
  if (!m.open) m.showModal();
}
function errorText(e) {
  return e.message || "Could not complete this action. Please try again.";
}
async function reload() {
  state = await rpc("snapshot");
  draft.instructor ||= state.instructors[0]?.id || "";
  draft.vehicle ||= state.vehicles[0]?.id || "";
  if (!navs[role()].some((n) => n[0] === page)) page = "overview";
  render();
}
async function navigate(p) {
  page = p;
  filter = "all";
  render();
  if (p === "book") await availability();
  window.scrollTo(0, 0);
}
async function mutate(action, payload, message) {
  if (busy) return;
  busy = true;
  const buttons = [...$("#modal").querySelectorAll("button")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    await rpc(action, payload);
    $("#modal").close();
    await reload();
    toast(message);
  } catch (e) {
    const error = $("#modal .error");
    if (error) error.textContent = errorText(e);
    else toast(errorText(e));
  } finally {
    busy = false;
    buttons.forEach((b) => (b.disabled = false));
  }
}
function auth(mode = "login", message = "") {
  const setup = !configured();
  $("#app").innerHTML =
    `<main class="auth-shell"><section class="auth-story"><div class="brand"><div class="brandmark">D</div>Drive<span>X</span></div><div><div class="eyebrow">Your driving journey</div><h1>Confidence starts<br>with the next lesson.</h1><p>Book your practice. Learn from your instructor.<br>See your progress, one drive at a time.</p></div><small>DriveX Driving School · Bengaluru</small></section><section class="auth-panel"><div class="auth-card">${setup ? `<div class="eyebrow">Connection required</div><h1>DriveX is awaiting its database.</h1><p class="sub">The live app has no sample accounts, lessons, or transactions. Account creation and bookings will become available when the school’s database is connected.</p><div class="hint">The project owner needs to connect a dedicated Supabase project. No booking has been made and no payment has been collected.</div>` : `<div class="eyebrow">DriveX account</div><h1>${mode === "signup" ? "Start your journey." : mode === "recover" ? "Reset your password." : mode === "password" ? "Choose a new password." : "Welcome back."}</h1><p class="sub">${mode === "signup" ? "Create your student account. Instructors receive access from the school administrator." : mode === "recover" ? "We’ll email you a password reset link." : "Your lessons and progress, in one place."}</p><form id="auth-form" class="modal-body">${mode === "signup" ? '<label>Full name<input name="name" autocomplete="name" maxlength="100" required></label><label>Phone<input name="phone" type="tel" autocomplete="tel" maxlength="30" required></label>' : ""}${mode !== "password" ? '<label>Email<input name="email" type="email" autocomplete="email" required></label>' : ""}${mode !== "recover" ? `<label>Password<input name="password" type="password" minlength="8" autocomplete="${mode === "login" ? "current-password" : "new-password"}" required></label>` : ""}<p class="error" role="alert" id="auth-error"></p>${message ? `<p class="sub" role="status">${esc(message)}</p>` : ""}<button class="primary full" type="submit">${mode === "signup" ? "Create account" : mode === "recover" ? "Send reset link" : mode === "password" ? "Update password" : "Sign in"}</button></form><div class="auth-links">${mode === "login" ? '<button class="link" data-auth="signup">Create a student account</button><button class="link" data-auth="recover">Forgot password?</button>' : '<button class="link" data-auth="login">Back to sign in</button>'}</div>`}</div></section></main>`;
  document
    .querySelectorAll("[data-auth]")
    .forEach((b) => (b.onclick = () => auth(b.dataset.auth)));
  if (setup) return;
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      button = e.currentTarget.querySelector("button");
    button.disabled = true;
    $("#auth-error").textContent = "";
    try {
      if (mode === "recover") {
        await recover(f.get("email"));
        auth("login", "If an account exists, a reset link has been sent.");
        return;
      }
      if (mode === "password") {
        await changePassword(f.get("password"));
        recovery = false;
        await reload();
        toast("Password updated.");
        return;
      }
      if (mode === "signup") {
        const active = await signup(
          f.get("name"),
          f.get("email"),
          f.get("password"),
          f.get("phone"),
        );
        if (!active) {
          auth(
            "login",
            "Check your email to confirm your account, then sign in.",
          );
          return;
        }
      } else await login(f.get("email"), f.get("password"));
      await reload();
    } catch (e) {
      $("#auth-error").textContent = errorText(e);
    } finally {
      button.disabled = false;
    }
  };
}
function intro(title, sub, button = "") {
  return `<div class="intro"><div><div class="eyebrow">${role() === "student" ? "Learner workspace" : role() === "admin" ? "School management" : "Instructor workspace"}</div><h1>${title}</h1><p class="sub">${sub}</p></div>${button}</div>`;
}
function stat(label, value, note) {
  return `<div class="stat"><div class="stat-head">${label}</div><div class="number">${value}</div><div class="stat-note">${note}</div></div>`;
}
function render() {
  if (!state) return;
  $("#app").innerHTML =
    `<div class="shell"><aside class="side"><div class="brand"><div class="brandmark">D</div>Drive<span>X</span></div><small>${role()} workspace</small><nav class="nav" aria-label="Main navigation">${navs[role()].map(([p, t], i) => `<button data-nav="${p}" class="${p === page ? "active" : ""}" ${p === page ? 'aria-current="page"' : ""}><span aria-hidden="true">${["◫", "▦", "◷", "◇", "▤"][i] || "◫"}</span>${t}</button>`).join("")}</nav><div class="side-bottom"><div class="side-note"><b>Confidence comes with practice.</b>One lesson closer to the open road.</div><div class="side-foot">DriveX Driving School</div></div></aside><div><header class="topbar"><div class="crumb">Workspace <b>/ ${navs[role()].find((n) => n[0] === page)?.[1]}</b></div><div class="persona"><div class="avatar">${initials(state.me.name)}</div><div class="meta-name">${esc(state.me.name)}<small>${role()}</small></div><button class="secondary" id="refresh">Refresh</button><button class="link" id="logout">Sign out</button></div></header><main class="content">${page === "overview" ? overview() : page === "book" ? booking() : page === "lessons" ? lessons() : page === "progress" ? progress() : page === "payments" ? payments() : resources()}<footer class="footer"><span>DriveX · Make every lesson count.</span><span>Lesson times: India Standard Time</span></footer></main></div></div>`;
  bind();
}
function overview() {
  const done = state.bookings.filter((b) => b.status === "completed"),
    up = state.bookings
      .filter((b) => b.status === "confirmed")
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
    avg = done.length
      ? (done.reduce((s, b) => s + b.score, 0) / done.length).toFixed(1)
      : "—";
  return `${intro(`Welcome, ${esc(state.me.name.split(" ")[0])}.`, "Your lessons, schedule, and progress are up to date.", role() === "student" ? '<button class="primary" data-nav="book">Book a lesson</button>' : "")}<div class="stats">${stat("Completed lessons", done.length, "Recorded lessons")}${stat("Confirmed lessons", up.length, "Payment received")}${stat("Average assessment", avg, "Out of 10")}${stat("Learning hours", done.length, "Completed practice time")}</div><div class="grid"><section class="panel panel-pad"><div class="panel-head"><h2>Next confirmed lesson</h2><button class="link" data-nav="lessons">View schedule</button></div>${up.length ? `<div class="lesson-hero"><div class="hero-top"><span class="eyebrow">${date(up[0].date)} · ${up[0].time} IST</span>${tag("confirmed")}</div><h2>${esc(car(up[0].vehicle)?.name)} driving lesson</h2><p class="sub">${who(up[0].instructor)} · 60 minutes</p><div class="hero-foot section-gap"><span>${esc(up[0].student)}</span><button class="primary lime" data-detail="${up[0].id}">Lesson details</button></div></div>` : '<div class="empty"><b>No confirmed lessons yet</b>Lessons appear here once the school records your payment.</div>'}<div class="hint">Bring your learner’s licence and arrive 10 minutes early.</div></section><section class="panel panel-pad"><h2>Learning progress</h2><div class="progress-layout section-gap"><div class="ring" style="--pct:${Math.min(done.length * 10, 100)}"><div class="ring-inner"><b>${done.length}</b><small>lessons</small></div></div><div><h3>${done.length ? "Keep the momentum going" : "Your journey starts here"}</h3><p class="sub">Your instructor’s feedback appears<br>after each completed lesson.</p></div></div><button class="secondary full" data-nav="${role() === "admin" ? "lessons" : "progress"}">${role() === "admin" ? "View all bookings" : "View feedback"}</button></section></div><section class="panel section-gap"><div class="panel-head table-title"><h2>Recent lessons</h2><button class="link" data-nav="lessons">View all</button></div>${table(state.bookings.slice(0, 5))}</section>`;
}
function table(rows) {
  return rows.length
    ? `<div class="table-wrap"><table><thead><tr><th>LESSON</th><th>STUDENT / INSTRUCTOR</th><th>VEHICLE</th><th>STATUS</th><th>ACTION</th></tr></thead><tbody>${rows.map((b) => `<tr><td>${date(b.date)}<small>${b.time} · 60 min</small></td><td>${esc(b.student)}<small>${who(b.instructor)}</small></td><td>${esc(car(b.vehicle)?.name || "Vehicle")}</td><td>${tag(b.status)}</td><td><button class="link" data-detail="${b.id}">${b.score ? `${b.score}/10 · Feedback` : "Details"}</button></td></tr>`).join("")}</tbody></table></div>`
    : '<div class="empty"><b>No lessons to show</b>New bookings will appear here.</div>';
}
function lessons() {
  return `${intro(role() === "admin" ? "All school bookings." : "Your lesson schedule.", "View lessons, payment status, and instructor feedback.")}<div class="filters">${["all", "pending", "confirmed", "completed", "cancellation_requested", "cancelled", "expired"].map((f) => `<button data-filter="${f}" class="${f === filter ? "active" : ""}">${f.replaceAll("_", " ")}</button>`).join("")}</div><section class="panel">${table(state.bookings.filter((b) => filter === "all" || b.status === filter))}</section>`;
}
async function availability() {
  draft.time = "";
  times = [];
  if (!draft.vehicle || !draft.instructor) {
    render();
    return;
  }
  render();
  try {
    const request = { ...draft },
      result = await rpc("availability", request);
    if (
      page !== "book" ||
      request.date !== draft.date ||
      request.instructor !== draft.instructor ||
      request.vehicle !== draft.vehicle
    )
      return;
    times = result;
    render();
  } catch (e) {
    toast(errorText(e));
    if (page === "book")
      $("#availability-status").textContent =
        "Could not load availability. Please try Refresh.";
  }
}
function booking() {
  const ready = state.instructors.length && state.vehicles.length;
  return `${intro("Make time for the road.", "Choose your instructor, vehicle, and a time that works for you.")}${!ready ? '<section class="panel empty"><b>Booking is not available yet.</b>The school needs to add an instructor and a vehicle first.</section>' : `<div class="grid"><section class="panel panel-pad"><h2>Book a 60-minute lesson</h2><div class="booking-form section-gap"><label>Lesson date<input id="lesson-date" type="date" min="${today()}" value="${draft.date}"></label><div class="form-row"><label>Instructor<select id="instructor">${state.instructors.map((i) => `<option value="${i.id}" ${i.id === draft.instructor ? "selected" : ""}>${esc(i.name)}</option>`).join("")}</select></label><label>Vehicle<select id="vehicle">${state.vehicles.map((v) => `<option value="${v.id}" ${v.id === draft.vehicle ? "selected" : ""}>${esc(v.name)} · ${esc(v.transmission)}</option>`).join("")}</select></label></div><div><h3>Available times · IST</h3><div class="slots section-gap">${times.map((t) => `<button class="slot ${draft.time === t.time ? "selected" : ""}" data-time="${t.time}" aria-pressed="${draft.time === t.time}" ${t.available ? "" : "disabled"}>${t.time}</button>`).join("")}</div><p class="sub" id="availability-status">${times.length ? "Unavailable times are crossed out." : "Loading availability…"}</p></div></div></section><section class="panel panel-pad" style="align-self:start"><h2>Your lesson</h2><div class="summary-line"><span>Date</span><b>${date(draft.date)}</b></div><div class="summary-line"><span>Time</span><b>${draft.time || "Select a time"}</b></div><div class="summary-line"><span>Instructor</span><span>${who(draft.instructor)}</span></div><div class="summary-line total"><span>Total</span><span>₹800</span></div><button class="primary full" id="reserve" ${draft.time ? "" : "disabled"}>Reserve lesson</button><div class="hint">Your slot is held for 30 minutes. Pay the school directly and ask the administrator to record the receipt before the hold expires. Online checkout is not connected.</div></section></div>`}`;
}
function progress() {
  const done = state.bookings.filter((b) => b.status === "completed");
  return `${intro("Every lesson moves you forward.", "Feedback recorded by your assigned instructor.")}<section class="panel panel-pad"><div class="panel-head"><h2>Lesson assessments</h2><span class="muted">${done.length} completed</span></div><div class="card-list">${done.length ? done.map((b) => `<article class="feedback"><div class="feedback-top"><h3>${date(b.date)} · ${esc(b.student)}</h3><span class="tag">${b.score} / 10</span></div><p>${esc(b.notes)}</p><p>${who(b.instructor)}</p></article>`).join("") : '<div class="empty"><b>No assessments yet</b>Complete a lesson to receive feedback.</div>'}</div></section>`;
}
function payments() {
  const ps = state.payments;
  return `${intro("Payments and receipts.", "Actual payments recorded by your school. Online checkout is not connected.")}<div class="stats">${stat("Recorded payments", money(ps.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0)), "Excludes refund requests")}${stat("Refund requests", ps.filter((p) => p.status === "refund_pending").length, "Awaiting school processing")}${stat("Refunded", money(ps.filter((p) => p.status === "refunded").reduce((s, p) => s + p.amount, 0)), "Recorded refund receipts")}${stat("Pending lessons", state.bookings.filter((b) => b.status === "pending").length, "Awaiting payment")}</div><section class="panel">${ps.length ? `<div class="table-wrap"><table><thead><tr><th>RECEIPT REFERENCE</th><th>RECORDED</th><th>AMOUNT</th><th>STATUS</th></tr></thead><tbody>${ps.map((p) => `<tr><td>${esc(p.reference)}${p.refund_reference ? `<small>Refund: ${esc(p.refund_reference)}</small>` : ""}</td><td>${new Date(p.created_at).toLocaleDateString("en-IN")}</td><td>${money(p.amount)}</td><td>${tag(p.status)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty"><b>No payments recorded</b>Your receipts will appear after the administrator confirms payment.</div>'}</section>`;
}
function resources() {
  const team = page === "team",
    items = team ? state.instructors : state.vehicles;
  return `${intro(team ? "Your instructor team." : "Your training fleet.", team ? "Assign instructor access to an existing DriveX account." : "Add vehicles that students can book.", `<button class="primary" id="add-resource">Add ${team ? "instructor" : "vehicle"}</button>`)}<div class="cards">${items.map((i) => `<article class="resource"><div class="avatar">${initials(i.name)}</div><h2>${esc(i.name)}</h2><p>${esc(team ? i.specialty : i.transmission)}</p><p>${esc(team ? i.phone : i.reg)}</p><span class="tag">Active</span></article>`).join("") || '<section class="panel empty"><b>No resources added</b>Add your first resource to enable bookings.</section>'}</div>`;
}
function detail(id) {
  const b = state.bookings.find((b) => b.id === id);
  if (!b) return;
  modal(
    "Lesson details",
    `<div class="modal-body">${tag(b.status)}<h3>${date(b.date)} · ${b.time} IST</h3><p class="sub">Student: ${esc(b.student)}${b.student_phone ? "<br>Contact: " + esc(b.student_phone) : ""}<br>Instructor: ${who(b.instructor)}<br>Vehicle: ${esc(car(b.vehicle)?.name)}<br>Lesson price: ${money(b.amount)}</p>${b.status === "pending" ? `<div class="hint">Pay the school directly. This reservation expires at ${new Date(b.expires_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. Only the administrator can confirm receipt.</div>` : ""}${b.score ? `<div class="feedback"><b>${b.score}/10</b><p>${esc(b.notes)}</p></div>` : ""}<p class="error" role="alert"></p><div class="modal-actions">${role() === "admin" && b.status === "pending" ? '<button class="primary" id="record-payment">Record received payment</button>' : ""}${role() === "admin" && b.status === "cancellation_requested" ? '<button class="primary" id="record-refund">Record completed refund</button>' : ""}${role() === "instructor" && b.status === "confirmed" && new Date(b.ends_at) <= new Date() ? '<button class="primary" id="assessment">Add assessment</button>' : ""}${role() !== "instructor" && ["pending", "confirmed"].includes(b.status) ? '<button class="danger" id="cancel">Cancel lesson</button>' : ""}</div></div>`,
  );
  if ($("#record-payment"))
    $("#record-payment").onclick = () => receipt(b, "record_payment");
  if ($("#record-refund"))
    $("#record-refund").onclick = () => receipt(b, "record_refund");
  if ($("#assessment")) $("#assessment").onclick = () => assessment(b);
  if ($("#cancel"))
    $("#cancel").onclick = () => {
      modal(
        "Cancel this lesson?",
        `<p class="sub">${b.status === "confirmed" ? "A paid lesson will become a cancellation request. The school must complete and record the refund; this app will not move money." : "This releases your unpaid reservation."}</p><p class="error" role="alert"></p><div class="modal-actions"><button class="secondary" id="keep">Keep lesson</button><button class="danger" id="confirm">Confirm cancellation</button></div>`,
      );
      $("#keep").onclick = () => detail(id);
      $("#confirm").onclick = () =>
        mutate(
          "cancel",
          { booking: id },
          b.status === "confirmed"
            ? "Cancellation requested. Contact the school about your refund."
            : "Lesson cancelled.",
        );
    };
}
function receipt(b, action) {
  const refund = action === "record_refund";
  modal(
    refund ? "Record an actual refund" : "Record payment received",
    `<p class="sub">${refund ? "Only submit after returning funds to the student." : "Only submit after verifying the school has received " + money(b.amount) + "."} This records the receipt; it does not transfer money.</p><form id="receipt-form" class="modal-body"><label>${refund ? "Refund" : "Payment"} receipt / transaction reference<input name="reference" minlength="3" maxlength="120" required></label><label class="check-label"><input name="verified" type="checkbox" required>I have verified the actual ${refund ? "refund" : "payment"}.</label><p class="error" role="alert"></p><button class="primary">Record ${refund ? "refund" : "payment"}</button></form>`,
  );
  $("#receipt-form").onsubmit = (e) => {
    e.preventDefault();
    mutate(
      action,
      {
        booking: b.id,
        reference: new FormData(e.currentTarget).get("reference"),
      },
      refund
        ? "Refund recorded. Lesson cancelled."
        : "Payment recorded. Lesson confirmed.",
    );
  };
}
function assessment(b) {
  modal(
    "Record lesson assessment",
    `<form class="modal-body" id="assessment-form"><label>Score (1–10)<input name="score" type="number" min="1" max="10" step="1" required></label><label>Lesson notes<textarea name="notes" maxlength="1500" required></textarea></label><p class="error" role="alert"></p><button class="primary">Save feedback & complete lesson</button></form>`,
  );
  $("#assessment-form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    mutate(
      "assess",
      { booking: b.id, score: Number(f.get("score")), notes: f.get("notes") },
      "Assessment saved. The student can see their feedback.",
    );
  };
}
function addResource() {
  const team = page === "team";
  modal(
    team ? "Assign instructor access" : "Add training vehicle",
    `<form class="modal-body" id="resource-form">${team ? '<p class="sub">Ask the instructor to create a DriveX account first. Enter that account’s email.</p><label>Account email<input name="email" type="email" required></label><label>Specialty<input name="specialty" maxlength="100" required></label>' : '<label>Vehicle model<input name="name" maxlength="100" required></label><label>Registration number<input name="reg" minlength="3" maxlength="30" required></label><label>Transmission<select name="transmission"><option>Manual</option><option>Automatic</option></select></label>'}<p class="error" role="alert"></p><button class="primary">${team ? "Assign instructor" : "Add vehicle"}</button></form>`,
  );
  $("#resource-form").onsubmit = (e) => {
    e.preventDefault();
    mutate(
      team ? "add_instructor" : "add_vehicle",
      Object.fromEntries(new FormData(e.currentTarget)),
      team ? "Instructor access assigned." : "Vehicle added.",
    );
  };
}
function bind() {
  document
    .querySelectorAll("[data-nav]")
    .forEach((b) => (b.onclick = () => navigate(b.dataset.nav)));
  $("#logout").onclick = async () => {
    try {
      await logout();
    } catch {}
    state = null;
    $("#modal").close();
    auth();
  };
  $("#refresh").onclick = async () => {
    try {
      await reload();
      if (page === "book") await availability();
      toast("Updated from the database.");
    } catch (e) {
      toast(errorText(e));
      if (!signedIn()) auth();
    }
  };
  document
    .querySelectorAll("[data-detail]")
    .forEach((b) => (b.onclick = () => detail(b.dataset.detail)));
  document.querySelectorAll("[data-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        filter = b.dataset.filter;
        render();
      }),
  );
  if ($("#add-resource")) $("#add-resource").onclick = addResource;
  if (page === "book" && $("#lesson-date")) {
    for (const [key, id] of [
      ["date", "lesson-date"],
      ["instructor", "instructor"],
      ["vehicle", "vehicle"],
    ])
      $("#" + id).onchange = (e) => {
        if (!e.target.value) return;
        draft[key] = e.target.value;
        availability();
      };
    document.querySelectorAll("[data-time]").forEach(
      (b) =>
        (b.onclick = () => {
          draft.time = b.dataset.time;
          render();
        }),
    );
    $("#reserve").onclick = async () => {
      if (busy) return;
      busy = true;
      $("#reserve").disabled = true;
      try {
        const result = await rpc("reserve", draft);
        page = "lessons";
        await reload();
        detail(result.id);
      } catch (e) {
        toast(errorText(e));
        await availability();
      } finally {
        busy = false;
      }
    };
  }
}
async function start() {
  if (!configured() || !signedIn()) {
    auth();
    return;
  }
  if (recovery) {
    auth("password");
    return;
  }
  $("#app").innerHTML =
    '<main class="empty" aria-live="polite">Loading your DriveX workspace…</main>';
  try {
    await reload();
  } catch (e) {
    $("#app").innerHTML =
      `<main class="auth-card"><h1>Unable to load your workspace.</h1><p class="sub">${esc(errorText(e))}</p><button class="primary section-gap" id="retry">Try again</button><button class="link" id="exit">Sign out</button></main>`;
    $("#retry").onclick = start;
    $("#exit").onclick = async () => {
      try {
        await logout();
      } catch {}
      auth();
    };
  }
}
start();
if (document.modelContext?.registerTool) {
  const lifetime = new AbortController();
  for (const tool of [
    {
      name: "read_my_lessons",
      description:
        "Read lessons currently authorized for the signed-in DriveX account.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute(input) {
        if (!input || Object.keys(input).length)
          throw Error("No parameters accepted.");
        if (!state || !signedIn()) throw Error("Sign in first.");
        return { bookings: state.bookings };
      },
    },
    {
      name: "open_booking_form",
      description:
        "Open the booking form for the signed-in student. Does not create a reservation.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      async execute(input) {
        if (!input || Object.keys(input).length)
          throw Error("No parameters accepted.");
        if (role() !== "student") throw Error("Student sign-in required.");
        await navigate("book");
        return { page: "book" };
      },
    },
  ])
    try {
      Promise.resolve(
        document.modelContext.registerTool(tool, { signal: lifetime.signal }),
      ).catch(() => {});
    } catch {}
  window.addEventListener("pagehide", () => lifetime.abort(), { once: true });
}
