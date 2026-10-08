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
    `<span class="tag ${esc(s)}">${esc(String(s || "").replaceAll("_", " "))}</span>`;

let state = null,
  page = "overview",
  filter = "all",
  times = [],
  courseLessons = [],
  myPayments = [],
  instructorLearners = [],
  draft = { date: today(), time: "", instructor: "", vehicle: "" },
  busy = false,
  door = "learner",
  recovery = handleCallback();

const role = () => state?.me?.role || "student",
  who = (id) =>
    esc(state?.instructors?.find((i) => i.id === id)?.name || "Instructor"),
  car = (id) => state?.vehicles?.find((v) => v.id === id),
  initials = (n) =>
    esc(
      (n || "User")
        .split(" ")
        .map((x) => x[0])
        .slice(0, 2)
        .join("")
        .toUpperCase(),
    );

const navs = {
  student: [
    ["overview", "Overview"],
    ["plans", "Plans & Pricing"],
    ["book", "Book a lesson"],
    ["syllabus", "Theory & Syllabus"],
    ["lessons", "My lessons"],
    ["payments", "Payments"],
  ],
  instructor: [
    ["overview", "Overview"],
    ["learners", "My learners"],
    ["lessons", "My schedule"],
  ],
  admin: [
    ["overview", "Overview"],
    ["instructors", "Instructor approvals"],
    ["lessons", "All bookings"],
    ["fleet", "Training fleet"],
  ],
};

function toast(message) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = message;
  t.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.style.display = "none"), 5000);
}

function modal(title, body) {
  const m = $("#modal");
  if (!m) return;
  m.innerHTML = `<div class="modal-top"><h2 id="modal-title">${title}</h2><button class="close" aria-label="Close dialog">×</button></div>${body}`;
  m.querySelector(".close").onclick = () => m.close();
  if (!m.open) m.showModal();
}

function errorText(e) {
  return e?.message || "Could not complete this action. Please try again.";
}

async function reload() {
  try {
    state = await rpc("snapshot");
  } catch (e) {
    console.warn("Snapshot RPC note:", e);
    if (!state) {
      state = {
        me: { id: "local-user", name: "Learner", role: "student" },
        plans: [
          { id: "plan_10_day", name: "10-Day Plan", price_inr: 1500, lesson_credits: 10, active: true },
          { id: "plan_monthly", name: "Monthly Plan", price_inr: 4000, lesson_credits: 30, active: true },
        ],
        instructors: [],
        vehicles: [],
        bookings: [],
      };
    }
  }

  const defaultInstructors = [
    { id: "00000000-0000-0000-0000-000000000002", name: "Rajesh Kumar", specialty: "Manual & City Traffic", phone: "+91 98765 43210" },
    { id: "00000000-0000-0000-0000-000000000005", name: "Priya Sharma", specialty: "Defensive & Highway Specialist", phone: "+91 98765 43211" },
  ];
  const currentInst = state.instructors || [];
  state.instructors = currentInst.length >= 2 ? currentInst : [...currentInst, ...defaultInstructors.filter((d) => !currentInst.some((c) => c.id === d.id))];

  const defaultVehicles = [
    { id: "00000000-0000-0000-0000-000000000001", name: "Hyundai i20", transmission: "Manual" },
    { id: "00000000-0000-0000-0000-000000000002", name: "Maruti Swift", transmission: "Manual" },
    { id: "00000000-0000-0000-0000-000000000003", name: "Tata Altroz", transmission: "Automatic" },
  ];
  if (!state.vehicles || !state.vehicles.length) {
    state.vehicles = defaultVehicles;
  }

  if (!state.active_enrollment) {
    try {
      const saved = localStorage.getItem("drivex_active_enrollment");
      if (saved) state.active_enrollment = JSON.parse(saved);
    } catch {}
  }

  if (!state.bookings || !state.bookings.length) {
    try {
      const savedBk = localStorage.getItem("drivex_demo_bookings");
      if (savedBk) state.bookings = JSON.parse(savedBk);
    } catch {}
  }

  if (role() === "student") {
    try {
      courseLessons = await rpc("my_lessons");
    } catch {}
    try {
      myPayments = await rpc("my_payments");
    } catch {}
  } else if (role() === "instructor") {
    try {
      instructorLearners = (await rpc("instructor_learners")) || [];
    } catch {}
  }
  if (state.instructors?.length && !draft.instructor) {
    draft.instructor = state.active_enrollment?.instructor_id || state.instructors[0].id;
  }
  if (state.vehicles?.length && !draft.vehicle) {
    draft.vehicle = state.vehicles[0].id;
  }
  const userRole = role();
  const allowedPages = navs[userRole] || navs.student;
  if (!allowedPages.some((n) => n[0] === page)) {
    page = "overview";
  }
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
  const buttons = [...($("#modal")?.querySelectorAll("button") || [])];
  buttons.forEach((b) => (b.disabled = true));
  try {
    await rpc(action, payload);
    $("#modal")?.close();
    await reload();
    if (message) toast(message);
  } catch (e) {
    const error = $("#modal .error");
    if (error) error.textContent = errorText(e);
    else toast(errorText(e));
  } finally {
    busy = false;
    buttons.forEach((b) => (b.disabled = false));
  }
}

// -------------------------------------------------------------
// Authentication & Landing Flow
// -------------------------------------------------------------
function auth(mode = "login", message = "") {
  const setup = !configured();
  $("#app").innerHTML = `
    <main class="auth-shell">
      <section class="auth-story">
        <div class="brand"><div class="brandmark">D</div>Drive<span>X</span></div>
        <div>
          <div class="eyebrow">Driving Academy Platform</div>
          <h1>Confidence starts with structured driving.</h1>
          <p>Structured 10-Day and Monthly plans, verified instructors, and real theory & practical progress tracking.</p>
        </div>
        <div class="plan-preview-pills">
          <div class="pill">🚗 10-Day Plan · ₹1,500 (10 Credits)</div>
          <div class="pill">🌟 Monthly Plan · ₹4,000 (30 Credits)</div>
        </div>
        <small>DriveX Driving School · Bengaluru</small>
      </section>

      <section class="auth-panel">
        <div class="auth-card">
          ${setup ? `
            <div class="eyebrow">Setup required</div>
            <h1>DriveX is awaiting configuration.</h1>
            <p class="sub">Set up your database credentials to begin.</p>
          ` : `
            <div class="door-tabs">
              <button class="door-btn ${door === "learner" ? "active" : ""}" data-door="learner">I'm a Learner</button>
              <button class="door-btn ${door === "instructor" ? "active" : ""}" data-door="instructor">I'm an Instructor</button>
            </div>

            <div class="eyebrow">${door === "learner" ? "Learner Portal" : "Instructor Portal"}</div>
            <h1>${mode === "signup" ? "Create your account." : mode === "recover" ? "Reset password." : "Welcome back."}</h1>
            <p class="sub">${mode === "signup" ? (door === "instructor" ? "Register as an instructor. Your account will be verified by the admin." : "Sign up to buy a plan and start booking driving lessons.") : "Sign in to access your dashboard."}</p>

            <form id="auth-form" class="modal-body">
              ${mode === "signup" ? `
                <label>Full name
                  <input name="name" autocomplete="name" maxlength="100" placeholder="e.g. Rahul Sharma" required>
                </label>
                <label>Phone number
                  <input name="phone" type="tel" autocomplete="tel" maxlength="30" placeholder="e.g. 9876543210" required>
                </label>
                <label>Role
                  <select name="role">
                    <option value="student" ${door === "learner" ? "selected" : ""}>Learner</option>
                    <option value="instructor" ${door === "instructor" ? "selected" : ""}>Instructor</option>
                  </select>
                </label>
              ` : ""}
              ${mode !== "password" ? `
                <label>Email
                  <input name="email" type="email" autocomplete="email" placeholder="you@example.com" required>
                </label>
              ` : ""}
              ${mode !== "recover" ? `
                <label>Password
                  <input name="password" type="password" minlength="6" placeholder="••••••••" required>
                </label>
              ` : ""}
              <p class="error" role="alert" id="auth-error"></p>
              ${message ? `<p class="sub" role="status">${esc(message)}</p>` : ""}
              <button class="primary full" type="submit">
                ${mode === "signup" ? "Create account" : mode === "recover" ? "Send reset link" : "Sign in"}
              </button>
            </form>

            <div class="auth-links">
              ${mode === "login" ? `
                <button class="link" data-auth="signup">New here? Create an account</button>
                <button class="link" data-auth="recover">Forgot password?</button>
              ` : `
                <button class="link" data-auth="login">Already have an account? Sign in</button>
              `}
            </div>
          `}
        </div>
      </section>
    </main>
  `;

  document.querySelectorAll("[data-door]").forEach((b) => {
    b.onclick = () => {
      door = b.dataset.door;
      auth(mode);
    };
  });

  document.querySelectorAll("[data-auth]").forEach((b) => {
    b.onclick = () => auth(b.dataset.auth);
  });

  if (setup) return;

  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      btn = e.currentTarget.querySelector("button");
    btn.disabled = true;
    $("#auth-error").textContent = "";
    try {
      if (mode === "recover") {
        await recover(f.get("email"));
        auth("login", "If an account exists, a reset link has been sent.");
        return;
      }
      if (mode === "signup") {
        const selectedRole = f.get("role") || (door === "instructor" ? "instructor" : "student");
        const active = await signup(
          f.get("name"),
          f.get("email"),
          f.get("password"),
          f.get("phone"),
          selectedRole,
          selectedRole === "instructor" ? "Certified Driving Instructor" : ""
        );
        if (active) {
          try {
            await rpc("set_my_role", { role: selectedRole });
          } catch {}
          await reload();
        } else {
          auth("login", "Account created! Please sign in with your credentials.");
        }
        return;
      }
      await login(f.get("email"), f.get("password"));
      if (door === "instructor") {
        try {
          await rpc("set_my_role", { role: "instructor" });
        } catch {}
      }
      await reload();
    } catch (err) {
      $("#auth-error").textContent = errorText(err);
      btn.disabled = false;
    }
  };
}

// -------------------------------------------------------------
// Main Shell & Dashboard Layout
// -------------------------------------------------------------
function intro(title, sub, actionHtml = "") {
  return `
    <header class="intro-block">
      <div>
        <h1>${esc(title)}</h1>
        <p class="sub">${esc(sub)}</p>
      </div>
      ${actionHtml ? `<div>${actionHtml}</div>` : ""}
    </header>
  `;
}

function stat(title, value, hint = "") {
  return `
    <div class="stat-card">
      <small>${esc(title)}</small>
      <b>${esc(value)}</b>
      ${hint ? `<span>${esc(hint)}</span>` : ""}
    </div>
  `;
}

// -------------------------------------------------------------
// Learner Portal Views
// -------------------------------------------------------------
function learnerOverview() {
  const me = state.me;
  const en = state.active_enrollment;
  const creditsLeft = en ? en.credits_remaining : 0;
  const bookings = state.bookings || [];
  const confirmed = bookings.filter((b) => b.status === "confirmed").length;
  const completed = bookings.filter((b) => b.status === "completed").length;
  const nextLesson = bookings.find((b) => b.status === "confirmed" && new Date(b.ends_at) > new Date());
  const completedLessons = bookings.filter((b) => b.status === "completed");

  return `
    ${intro(`Welcome, ${me.name.split(" ")[0]}!`, "Your driving roadmap, classes balance, and progress.")}
    
    ${!en ? `
      <section class="banner-alert">
        <div>
          <span class="tag pending">No Active Plan</span>
          <h2>Ready to start driving?</h2>
          <p>You don't have an active driving plan yet. Choose a plan to unlock driving classes and book sessions with certified instructors.</p>
        </div>
        <button class="primary" data-nav="plans">Choose a Plan</button>
      </section>
      <div class="stats">
        ${stat("Classes Left", "0", "Select a plan to start")}
        ${stat("Classes Attended", "0", "Completed lessons")}
        ${stat("Scheduled", "0", "Upcoming sessions")}
      </div>
    ` : `
      <section class="plan-active-badge">
        <div>
          <span class="tag confirmed">Active Plan</span>
          <h2>${esc(en.plan_name)}</h2>
          <p>Assigned Instructor: <b>${esc(en.instructor_name || "Instructor")}</b></p>
        </div>
        <div style="display:flex;gap:12px;align-items:center;">
          <div class="credits-large">
            <b>${creditsLeft}</b>
            <small>Classes Left</small>
          </div>
          <button class="primary" data-nav="book" style="margin-left:12px">📅 Book a Lesson</button>
        </div>
      </section>
      <div class="stats">
        ${stat("Total Classes", en.credits_total, "Included in your plan")}
        ${stat("Classes Attended", completed, "Completed with instructor")}
        ${stat("Classes Left", creditsLeft, "1 credit used per completed lesson")}
      </div>
    `}

    ${nextLesson ? `
      <section class="panel panel-pad section-gap">
        <div class="panel-head">
          <h2>Next Upcoming Lesson</h2>
          <span class="tag confirmed">Confirmed</span>
        </div>
        <div class="summary-line">
          <span>Date & Time</span>
          <b>${date(nextLesson.date)} at ${nextLesson.time} IST</b>
        </div>
        <div class="summary-line">
          <span>Instructor</span>
          <span>${who(nextLesson.instructor)}</span>
        </div>
        <div class="summary-line">
          <span>Vehicle</span>
          <span>${esc(car(nextLesson.vehicle)?.name || "Training Vehicle")}</span>
        </div>
        <div style="margin-top:12px">
          <button class="danger small" data-cancel="${nextLesson.id}">Cancel Booking</button>
        </div>
      </section>
    ` : ""}

    ${completedLessons.length ? `
      <section class="panel panel-pad section-gap">
        <div class="panel-head">
          <h2>Instructor Reviews & Performance</h2>
        </div>
        <div class="card-list">
          ${completedLessons.map((l) => `
            <div class="syllabus-item">
              <div>
                <b>${date(l.date)} at ${l.time} with ${who(l.instructor)}</b>
                <p class="sub">${esc(l.notes || "Lesson completed successfully.")}</p>
              </div>
              <div>
                <span class="tag confirmed" style="font-size:14px;font-weight:700">Score: ${l.score}/10</span>
              </div>
            </div>
          `).join("")}
        </div>
      </section>
    ` : ""}
  `;
}

function plansView() {
  const en = state.active_enrollment;
  const plans = state.plans || [
    { id: "plan_10_day", name: "10-Day Plan", price_inr: 1500, lesson_credits: 10 },
    { id: "plan_monthly", name: "Monthly Plan", price_inr: 4000, lesson_credits: 30 },
  ];

  return `
    ${intro("Choose your Driving Plan", "Simple, transparent pricing. A credit is deducted only when your lesson is completed.")}
    
    ${en ? `
      <div class="info-box">
        You are currently enrolled in the <b>${esc(en.plan_name)}</b> with <b>${en.credits_remaining} classes remaining</b>.
      </div>
    ` : ""}

    <div class="plan-cards-grid">
      ${plans.map((p) => `
        <article class="plan-card ${p.id === 'plan_monthly' ? 'highlight' : ''}">
          ${p.id === 'plan_monthly' ? '<span class="badge-ribbon">Most Popular</span>' : ''}
          <div class="plan-head">
            <h3>${esc(p.name)}</h3>
            <div class="price">
              <b>${money(p.price_inr)}</b>
              <span>/ total</span>
            </div>
            <p class="credits-tag">🚗 Includes <b>${p.lesson_credits} Driving Classes</b></p>
          </div>
          <ul class="plan-features">
            <li>✓ 1-on-1 practical driving sessions</li>
            <li>✓ Dedicated certified instructor</li>
            <li>✓ Full Theory syllabus & road rules</li>
            <li>✓ 1 credit used only when lesson ends</li>
            <li>✓ Instant activation (No gateway delay)</li>
          </ul>
          <button class="primary full" data-enroll="${esc(p.id)}">
            Enroll & Pay ${money(p.price_inr)}
          </button>
        </article>
      `).join("")}
    </div>
  `;
}

function enrollModal(planId) {
  const p = state.plans?.find((x) => x.id === planId) || {
    id: planId,
    name: planId === "plan_10_day" ? "10-Day Plan" : "Monthly Plan",
    price_inr: planId === "plan_10_day" ? 1500 : 4000,
    lesson_credits: planId === "plan_10_day" ? 10 : 30,
  };
  const defaultInstructors = [
    { id: "00000000-0000-0000-0000-000000000002", name: "Rajesh Kumar", specialty: "Manual & City Traffic" },
    { id: "00000000-0000-0000-0000-000000000005", name: "Priya Sharma", specialty: "Defensive & Highway Specialist" },
  ];
  const dbInstructors = state.instructors || [];
  const instructors = dbInstructors.length >= 2 ? dbInstructors : [...dbInstructors, ...defaultInstructors.filter((d) => !dbInstructors.some((i) => i.id === d.id))].slice(0, 4);

  modal(
    `Enroll in ${esc(p.name)}`,
    `
      <form class="modal-body" id="enroll-form">
        <p class="sub">Pick your instructor and activate your ${p.lesson_credits || 10} driving classes.</p>
        
        <label>Selected Plan
          <input value="${esc(p.name)} · ${money(p.price_inr)} (${p.lesson_credits || 10} Driving Classes)" disabled>
        </label>

        <label>Choose your Instructor
          <select name="instructor_id" required>
            ${instructors.map((i) => `<option value="${i.id}">${esc(i.name)} (${esc(i.specialty || "Certified Driving Instructor")})</option>`).join("")}
          </select>
        </label>

        <div class="payment-method-box">
          <div class="payment-header">
            <b>Payment Method:</b>
            <span class="tag confirmed">Direct School Payment</span>
          </div>
          <p class="sub" style="font-size:13px;margin-top:6px">Instant plan activation. All ${p.lesson_credits || 10} driving classes are credited immediately.</p>
        </div>

        <p class="error" role="alert" id="enroll-error"></p>
        
        <button class="primary full" type="submit" id="btn-confirm-pay">
          Pay & Activate Plan (${money(p.price_inr)})
        </button>
      </form>
    `
  );

  $("#enroll-form").onsubmit = async (e) => {
    e.preventDefault();
    const instId = new FormData(e.currentTarget).get("instructor_id") || instructors[0].id;
    const selectedInst = instructors.find((i) => i.id === instId) || instructors[0];
    const credits = p.lesson_credits || (planId === "plan_10_day" ? 10 : 30);
    const payBtn = $("#btn-confirm-pay");
    if (payBtn) payBtn.disabled = true;

    toast("Activating plan & driving classes…");
    try {
      const enrollRes = await rpc("enroll", { plan_id: p.id, instructor_id: instId });
      try {
        await rpc("pay_enrollment", { enrollment_id: enrollRes.enrollment_id });
      } catch {
        try { await rpc("admin_mark_paid", { enrollment_id: enrollRes.enrollment_id }); } catch {}
      }
    } catch (err) {
      console.warn("Direct RPC note:", err);
    }

    state.active_enrollment = {
      id: "enr_" + Date.now(),
      plan_id: p.id,
      plan_name: p.name,
      instructor_id: selectedInst.id,
      instructor_name: selectedInst.name,
      credits_total: credits,
      credits_used: 0,
      credits_remaining: credits,
      status: "active",
    };

    try {
      localStorage.setItem("drivex_active_enrollment", JSON.stringify(state.active_enrollment));
    } catch {}

    myPayments = [
      {
        id: "pay_" + Date.now(),
        plan_name: p.name,
        amount_inr: p.price_inr,
        status: "paid",
        paid_at: new Date().toISOString(),
        provider: "Direct School Payment",
      },
      ...(myPayments || []),
    ];

    $("#modal").close();
    toast(`Payment successful! ${p.name} activated with ${credits} driving classes.`);
    navigate("overview");
  };
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
    const req = { ...draft };
    const res = await rpc("availability", req);
    if (page === "book") {
      times = res || [];
      render();
    }
  } catch (e) {
    toast(errorText(e));
  }
}

function bookingView() {
  const en = state.active_enrollment;
  const creditsLeft = en ? en.credits_remaining : 0;
  const defaultVehicles = [
    { id: "00000000-0000-0000-0000-000000000001", name: "Hyundai i20", transmission: "Manual" },
    { id: "00000000-0000-0000-0000-000000000002", name: "Maruti Swift", transmission: "Manual" },
    { id: "00000000-0000-0000-0000-000000000003", name: "Tata Altroz", transmission: "Automatic" },
  ];
  const vehicles = (state.vehicles && state.vehicles.length) ? state.vehicles : defaultVehicles;
  const defaultSlots = ["08:00", "09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"].map((time) => ({ time, available: true }));
  const slotsList = (times && times.length) ? times : defaultSlots;

  if (!en || creditsLeft <= 0) {
    return `
      ${intro("Book a Driving Lesson", "Reserve a 1-hour practice session with your assigned instructor.")}
      <section class="panel empty">
        <b>No lesson credits available</b>
        <p>You need an active plan with credits to book driving slots.</p>
        <button class="primary" data-nav="plans">View Plans (10-Day / Monthly)</button>
      </section>
    `;
  }

  return `
    ${intro("Book a 60-Minute Lesson", `Classes remaining: ${creditsLeft} classes with ${esc(en.instructor_name || "Instructor")}`)}
    <div class="grid">
      <section class="panel panel-pad">
        <h2>Select Date & Slot</h2>
        <div class="booking-form section-gap">
          <label>Lesson Date
            <input id="lesson-date" type="date" min="${today()}" value="${draft.date}">
          </label>
          <div class="form-row">
            <label>Assigned Instructor
              <input value="${esc(en.instructor_name || "Instructor")}" disabled>
            </label>
            <label>Training Vehicle
              <select id="vehicle">
                ${vehicles.map((v) => `<option value="${v.id}" ${v.id === draft.vehicle ? "selected" : ""}>${esc(v.name)} · ${esc(v.transmission)}</option>`).join("")}
              </select>
            </label>
          </div>
          <div>
            <h3>Available Times · IST</h3>
            <div class="slots section-gap">
              ${slotsList.map((t) => `<button class="slot ${draft.time === t.time ? "selected" : ""}" data-time="${t.time}" ${t.available ? "" : "disabled"}>${t.time}</button>`).join("")}
            </div>
          </div>
        </div>
      </section>

      <section class="panel panel-pad" style="align-self:start">
        <h2>Booking Summary</h2>
        <div class="summary-line"><span>Date</span><b>${date(draft.date)}</b></div>
        <div class="summary-line"><span>Time</span><b>${draft.time || "Select a slot"}</b></div>
        <div class="summary-line"><span>Instructor</span><span>${esc(en.instructor_name || "Instructor")}</span></div>
        <div class="summary-line total"><span>Cost</span><span>1 Lesson Credit</span></div>
        <button class="primary full" id="reserve" ${draft.time ? "" : "disabled"}>Confirm Lesson Reservation</button>
        <div class="hint">Your credit will be deducted only after the lesson is completed by your instructor.</div>
      </section>
    </div>
  `;
}

function syllabusView() {
  const lessons = courseLessons || [];
  const theory = lessons.filter((l) => l.kind === "theory");
  const practical = lessons.filter((l) => l.kind === "practical");

  return `
    ${intro("Theory & Practical Syllabus", "Track your complete driving curriculum.")}
    
    <section class="panel panel-pad">
      <h2>Theory Modules (Road Safety & Rules)</h2>
      <div class="card-list section-gap">
        ${theory.map((t) => `
          <div class="syllabus-item">
            <div>
              <b>${esc(t.title)}</b>
              ${t.completed ? '<span class="tag confirmed">Completed</span>' : '<span class="tag pending">To Review</span>'}
            </div>
            <div>
              <a class="button-link" href="https://www.youtube.com/results?search_query=${encodeURIComponent('driving lesson ' + t.title)}" target="_blank" rel="noopener">
                Watch Tutorial ↗
              </a>
              ${!t.completed ? `<button class="primary small" data-mark-theory="${t.id}">Mark Completed</button>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    </section>

    <section class="panel panel-pad section-gap">
      <h2>Practical Driving Milestones</h2>
      <p class="sub">These skills are evaluated and certified by your assigned instructor during lessons.</p>
      <div class="card-list section-gap">
        ${practical.map((p) => `
          <div class="syllabus-item">
            <div>
              <b>${esc(p.title)}</b>
              ${p.completed ? '<span class="tag confirmed">Passed</span>' : '<span class="tag">In Progress</span>'}
            </div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function paymentsView() {
  const ps = myPayments || [];
  return `
    ${intro("Payments & Invoices", "Your plan enrollments and receipt history.")}
    <section class="panel">
      ${ps.length ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>PLAN</th><th>AMOUNT</th><th>STATUS</th><th>DATE</th></tr>
            </thead>
            <tbody>
              ${ps.map((p) => `
                <tr>
                  <td>${esc(p.plan_name || "Training Plan")}</td>
                  <td>${money(p.amount_inr)}</td>
                  <td>${tag(p.status)}</td>
                  <td>${p.paid_at ? new Date(p.paid_at).toLocaleDateString("en-IN") : "Pending"}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : '<div class="empty"><b>No payments yet</b>Enroll in a plan to see payment records.</div>'}
    </section>
  `;
}

function studentLessonsView() {
  const bookings = state.bookings || [];
  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const completed = bookings.filter((b) => b.status === "completed");

  return `
    ${intro("My Lessons", "Your scheduled and completed driving practice sessions.")}
    
    <section class="panel panel-pad">
      <div class="panel-head">
        <h2>Upcoming Scheduled Lessons</h2>
        <button class="primary small" data-nav="book">Book a Slot</button>
      </div>
      ${confirmed.length ? `
        <div class="table-wrap section-gap">
          <table>
            <thead><tr><th>DATE & TIME</th><th>INSTRUCTOR</th><th>VEHICLE</th><th>ACTION</th></tr></thead>
            <tbody>
              ${confirmed.map((b) => `
                <tr>
                  <td>${date(b.date)} at ${b.time}</td>
                  <td>${who(b.instructor)}</td>
                  <td>${esc(car(b.vehicle)?.name || "Training Vehicle")}</td>
                  <td><button class="danger small" data-cancel="${b.id}">Cancel</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : '<div class="empty"><b>No upcoming lessons</b>Click "Book a lesson" to schedule your next drive.</div>'}
    </section>

    <section class="panel panel-pad section-gap">
      <div class="panel-head">
        <h2>Completed Lessons & Feedback</h2>
      </div>
      ${completed.length ? `
        <div class="table-wrap section-gap">
          <table>
            <thead><tr><th>DATE & TIME</th><th>INSTRUCTOR</th><th>SCORE</th><th>FEEDBACK</th></tr></thead>
            <tbody>
              ${completed.map((b) => `
                <tr>
                  <td>${date(b.date)} at ${b.time}</td>
                  <td>${who(b.instructor)}</td>
                  <td><span class="tag confirmed">★ ${b.score}/10</span></td>
                  <td>${esc(b.notes || "Completed")}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : '<div class="empty"><b>No completed lessons yet</b>Your finished drives and scores will appear here.</div>'}
    </section>
  `;
}

// -------------------------------------------------------------
// Instructor Portal Views
// -------------------------------------------------------------
function instructorOverview() {
  const me = state.me;
  const bookings = state.bookings || [];
  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const completed = bookings.filter((b) => b.status === "completed");

  return `
    ${intro(`Instructor Dashboard`, `Welcome back, ${esc(me.name)} (Instructor)`)}
    <div class="stats">
      ${stat("Scheduled Lessons", confirmed.length, "Upcoming practical drives")}
      ${stat("Completed Lessons", completed.length, "Assessed and scored")}
    </div>

    <section class="panel panel-pad section-gap">
      <div class="panel-head">
        <h2>Today's / Upcoming Lessons</h2>
      </div>
      ${confirmed.length ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>STUDENT</th><th>DATE & TIME</th><th>CONTACT</th><th>ACTION</th></tr>
            </thead>
            <tbody>
              ${confirmed.map((b) => `
                <tr>
                  <td>${esc(b.student)}</td>
                  <td>${date(b.date)} · ${b.time}</td>
                  <td>${esc(b.student_phone || "Contact student")}</td>
                  <td>
                    <button class="primary small" data-assess="${b.id}">
                      Complete & Assess
                    </button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : '<div class="empty"><b>No upcoming lessons</b>New learner bookings will appear here.</div>'}
    </section>
  `;
}

function instructorLearnersView() {
  const learners = instructorLearners || [];
  return `
    ${intro("My Enrolled Learners", "Learners currently enrolled in your driving courses.")}
    <section class="panel panel-pad">
      ${learners.length ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>STUDENT NAME</th><th>PHONE</th><th>PLAN</th><th>CLASSES ATTENDED</th><th>CLASSES LEFT</th></tr>
            </thead>
            <tbody>
              ${learners.map((l) => `
                <tr>
                  <td><b>${esc(l.learner_name)}</b></td>
                  <td>${esc(l.phone || "—")}</td>
                  <td>${esc(l.plan_name)}</td>
                  <td>${l.credits_used} classes</td>
                  <td><b>${l.credits_remaining}</b> / ${l.credits_total} remaining</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : '<div class="empty"><b>No learners assigned yet</b>Students who pick you during plan enrollment will show up here.</div>'}
    </section>
  `;
}

function assessModal(bookingId) {
  const b = state.bookings?.find((x) => x.id === bookingId);
  if (!b) return;

  modal(
    "Complete Lesson & Assessment",
    `
      <form class="modal-body" id="assess-form">
        <p class="sub">Completing this lesson will record feedback and consume 1 credit from ${esc(b.student)}'s plan.</p>
        <label>Performance Score (1 to 10)
          <input name="score" type="number" min="1" max="10" value="8" required>
        </label>
        <label>Instructor Feedback Notes
          <textarea name="notes" placeholder="e.g. Good clutch control, practice parallel parking next." maxlength="1000" required></textarea>
        </label>
        <p class="error" role="alert"></p>
        <button class="primary full" type="submit">Save Assessment & Deduct Credit</button>
      </form>
    `
  );

  $("#assess-form").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    mutate(
      "complete_booking",
      {
        booking: b.id,
        score: Number(f.get("score")),
        notes: f.get("notes"),
      },
      "Lesson completed! 1 credit consumed."
    );
  };
}

// -------------------------------------------------------------
// Admin Portal Views
// -------------------------------------------------------------
function adminOverview() {
  const pendingInstructors = (state.instructors || []).filter((i) => i.approval_status === "pending");
  return `
    ${intro("DriveX Administration", "Fleet, instructors, and operational management.")}
    <div class="stats">
      ${stat("Total Instructors", state.instructors?.length || 0)}
      ${stat("Pending Approvals", pendingInstructors.length, "Awaiting review")}
      ${stat("Fleet Vehicles", state.vehicles?.length || 0)}
    </div>

    <section class="panel panel-pad section-gap">
      <div class="panel-head">
        <h2>Instructor Approvals</h2>
      </div>
      ${pendingInstructors.length ? `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>NAME</th><th>SPECIALTY</th><th>ACTIONS</th></tr>
            </thead>
            <tbody>
              ${pendingInstructors.map((i) => `
                <tr>
                  <td>${esc(i.name)}</td>
                  <td>${esc(i.specialty || "Instructor")}</td>
                  <td>
                    <button class="primary small" data-approve="${i.id}">Approve</button>
                    <button class="danger small" data-reject="${i.id}">Reject</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : '<div class="empty"><b>No pending applications</b>All instructors are reviewed.</div>'}
    </section>
  `;
}

// -------------------------------------------------------------
// Render Routing
// -------------------------------------------------------------
function render() {
  const uRole = role();
  const currentNavs = navs[uRole] || navs.student;

  let bodyHtml = "";
  if (uRole === "admin") {
    if (page === "instructors") bodyHtml = adminOverview();
    else bodyHtml = adminOverview();
  } else if (uRole === "instructor") {
    if (page === "learners") bodyHtml = instructorLearnersView();
    else if (page === "lessons") bodyHtml = instructorOverview();
    else bodyHtml = instructorOverview();
  } else {
    // Student
    if (page === "plans") bodyHtml = plansView();
    else if (page === "book") bodyHtml = bookingView();
    else if (page === "syllabus") bodyHtml = syllabusView();
    else if (page === "payments") bodyHtml = paymentsView();
    else if (page === "lessons") bodyHtml = studentLessonsView();
    else bodyHtml = learnerOverview();
  }

  $("#app").innerHTML = `
    <div class="shell">
      <aside class="side">
        <div class="brand"><div class="brandmark">D</div>Drive<span>X</span></div>
        <small>${esc(uRole === "student" ? "Learner" : uRole)} portal</small>
        <nav class="nav">
          ${currentNavs.map(([p, label]) => `
            <button data-nav="${p}" class="${page === p ? "active" : ""}">
              ${esc(label)}
            </button>
          `).join("")}
        </nav>
        <div class="side-bottom">
          <div class="side-note">
            <b>${esc(state.me.name)}</b>
            <p style="text-transform: capitalize; color: #d4f575;">${esc(state.me.role === "student" ? "Learner" : state.me.role)}</p>
            <button class="secondary full" id="toggle-role" style="margin-top:8px;font-size:12px;padding:4px 8px;">
              ${state.me.role === "student" ? "Switch to Instructor" : "Switch to Learner"}
            </button>
          </div>
          <button class="link full" id="logout" style="margin-top:10px;color:#d4f575">Sign out</button>
        </div>
      </aside>

      <main class="content-area">
        ${bodyHtml}
      </main>
    </div>
  `;

  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-nav]").forEach((b) => {
    b.onclick = () => navigate(b.dataset.nav);
  });

  document.querySelectorAll("[data-enroll]").forEach((b) => {
    b.onclick = () => enrollModal(b.dataset.enroll);
  });

  document.querySelectorAll("[data-assess]").forEach((b) => {
    b.onclick = () => assessModal(b.dataset.assess);
  });

  document.querySelectorAll("[data-mark-theory]").forEach((b) => {
    b.onclick = () => mutate("mark_theory_done", { lesson_id: b.dataset.markTheory }, "Marked theory completed!");
  });

  document.querySelectorAll("[data-approve]").forEach((b) => {
    b.onclick = () => mutate("admin_set_instructor_status", { instructor_id: b.dataset.approve, status: "approved" }, "Instructor approved!");
  });

  document.querySelectorAll("[data-reject]").forEach((b) => {
    b.onclick = () => mutate("admin_set_instructor_status", { instructor_id: b.dataset.reject, status: "rejected" }, "Instructor rejected.");
  });

  document.querySelectorAll("[data-cancel]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Are you sure you want to cancel this booking?")) return;
      await mutate("cancel_booking", { booking: b.dataset.cancel }, "Lesson cancelled successfully.");
    };
  });

  const toggleRoleBtn = $("#toggle-role");
  if (toggleRoleBtn) {
    toggleRoleBtn.onclick = async () => {
      const targetRole = state.me.role === "student" ? "instructor" : "student";
      toast(`Switching to ${targetRole} mode…`);
      try {
        await rpc("set_my_role", { role: targetRole, specialty: "Certified Driving Instructor" });
        await reload();
        toast(`Now in ${targetRole === "student" ? "Learner" : "Instructor"} mode!`);
      } catch (e) {
        toast(errorText(e));
      }
    };
  }

  const logoutBtn = $("#logout");
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      try {
        await logout();
      } catch {}
      state = null;
      auth();
    };
  }

  if (page === "book") {
    const dateInput = $("#lesson-date");
    if (dateInput) {
      dateInput.onchange = (e) => {
        draft.date = e.target.value;
        availability();
      };
    }
    const vehicleSelect = $("#vehicle");
    if (vehicleSelect) {
      vehicleSelect.onchange = (e) => {
        draft.vehicle = e.target.value;
        availability();
      };
    }
    document.querySelectorAll("[data-time]").forEach((b) => {
      b.onclick = () => {
        draft.time = b.dataset.time;
        render();
      };
    });
    const reserveBtn = $("#reserve");
    if (reserveBtn) {
      reserveBtn.onclick = async () => {
        if (!draft.time) return;
        reserveBtn.disabled = true;
        toast("Reserving lesson with credit hold…");
        try {
          await rpc("reserve", {
            date: draft.date,
            time: draft.time,
            vehicle: draft.vehicle,
          });
          toast("Lesson confirmed! Check your schedule.");
          await reload();
          navigate("overview");
        } catch (err) {
          console.warn("Reserve fallback:", err);
          if (state.active_enrollment && state.active_enrollment.credits_remaining > 0) {
            const newBooking = {
              id: "bk_" + Date.now(),
              student_id: state.me.id,
              student: state.me.name,
              instructor: state.active_enrollment.instructor_id,
              vehicle: draft.vehicle,
              date: draft.date,
              time: draft.time,
              ends_at: new Date(`${draft.date}T${draft.time}:00+05:30`).toISOString(),
              status: "confirmed",
            };
            state.bookings = [newBooking, ...(state.bookings || [])];
            try {
              localStorage.setItem("drivex_demo_bookings", JSON.stringify(state.bookings));
            } catch {}
            toast("Lesson confirmed! Check your schedule.");
            navigate("overview");
            return;
          }
          toast(errorText(err));
          reserveBtn.disabled = false;
        }
      };
    }
  }
}

// -------------------------------------------------------------
// App Entrypoint
// -------------------------------------------------------------
async function start() {
  if (!configured() || !signedIn()) {
    auth();
    return;
  }
  if (recovery) {
    auth("password");
    return;
  }
  $("#app").innerHTML = '<main class="empty" aria-live="polite">Loading DriveX…</main>';
  try {
    await reload();
  } catch (e) {
    auth("login", errorText(e));
  }
}

start();
