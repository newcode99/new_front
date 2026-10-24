/**
 * app.js: 릴리(Lilly) AI 인터랙션, 상태 머신, 사이드바 토글, DB 로그 뷰어 & UX 고도화
 */

let currentAuthTab = "login";
let currentDbTab = "logs";
let isGenerating = false;
let activeStreamController = null;
let currentActiveChatId = null;
let lastFailedPrompt = null;

// 릴리 미니 SVG 아바타 HTML 템플릿
const LILLY_AVATAR_HTML = `
<div class="lilly-msg-avatar" title="릴리 AI">
    <svg viewBox="0 0 120 120" width="28" height="28">
        <circle cx="60" cy="60" r="54" fill="#EEF2FF" stroke="#6366F1" stroke-width="3"/>
        <rect x="42" y="16" width="36" height="14" rx="3" fill="#312E81" />
        <line x1="48" y1="16" x2="52" y2="30" stroke="#FFF" stroke-width="2"/>
        <line x1="60" y1="16" x2="64" y2="30" stroke="#FFF" stroke-width="2"/>
        <line x1="72" y1="16" x2="76" y2="30" stroke="#FFF" stroke-width="2"/>
        <circle cx="60" cy="65" r="32" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1.5"/>
        <ellipse class="lilly-eye eye-left" cx="49" cy="63" rx="3.5" ry="5" fill="#1E1B4B"/>
        <ellipse class="lilly-eye eye-right" cx="71" cy="63" rx="3.5" ry="5" fill="#1E1B4B"/>
        <circle cx="50" cy="61" r="1.5" fill="#FFF"/>
        <circle cx="72" cy="61" r="1.5" fill="#FFF"/>
        <circle cx="43" cy="70" r="4.5" fill="#F472B6" opacity="0.6"/>
        <circle cx="77" cy="70" r="4.5" fill="#F472B6" opacity="0.6"/>
        <path d="M53 73 Q60 81 67 73" stroke="#1E1B4B" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    </svg>
</div>`;

// 초기화
document.addEventListener("DOMContentLoaded", () => {
    checkAuthState();
    loadChatHistory();
    setupShortcuts();
});

// 키보드 단축키 설정 (사이드바 토글 Ctrl+B 등)
function setupShortcuts() {
    window.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
            e.preventDefault();
            toggleSidebar();
        }
    });
}

// 1. 인증 상태 및 메인 페이지 로그인/비로그인 뷰 관리
function checkAuthState() {
    const token = localStorage.getItem("access_token");
    const username = localStorage.getItem("username");
    const isLoggedIn = Boolean(token && token.trim().length > 0);

    const guestActions = document.getElementById("topbar-guest-actions");
    const userActions = document.getElementById("topbar-user-actions");
    const topbarUsername = document.getElementById("topbar-username");
    const sidebarAvatar = document.getElementById("current-user-avatar");
    const sidebarUsername = document.getElementById("current-user-name");
    const sidebarStatus = document.getElementById("current-user-status");
    const loginGate = document.getElementById("login-required-overlay");

    if (isLoggedIn) {
        // [로그인 상태]
        const displayName = username || "Creator";
        if (guestActions) guestActions.style.display = "none";
        if (userActions) userActions.style.display = "flex";
        if (topbarUsername) topbarUsername.innerText = displayName;
        if (sidebarAvatar) sidebarAvatar.innerText = displayName.charAt(0).toUpperCase();
        if (sidebarUsername) sidebarUsername.innerText = displayName;
        if (sidebarStatus) sidebarStatus.innerText = "● 기획 모드 활성";
        if (loginGate) loginGate.style.display = "none";
    } else {
        // [비로그인 둘러보기 상태: 질문 입력 잠금 및 로그인 넛지]
        if (guestActions) guestActions.style.display = "flex";
        if (userActions) userActions.style.display = "none";
        if (sidebarAvatar) sidebarAvatar.innerText = "G";
        if (sidebarUsername) sidebarUsername.innerText = "게스트 (비로그인)";
        if (sidebarStatus) sidebarStatus.innerText = "○ 로그인 필요";
        if (loginGate) loginGate.style.display = "flex";
    }
}

// 상단 로그인/회원가입 모달 열기
function openAuthModal(tab = "login") {
    switchAuthTab(tab);
    const modal = document.getElementById("auth-modal");
    if (modal) modal.style.display = "flex";
}

function closeAuthModal() {
    const modal = document.getElementById("auth-modal");
    if (modal) modal.style.display = "none";
}

function switchAuthTab(tab) {
    currentAuthTab = tab;
    const isLogin = tab === "login";

    const titleEl = document.getElementById("auth-modal-title");
    if (titleEl) titleEl.innerText = isLogin ? "크리에이터 로그인" : "크리에이터 회원가입";

    const tabLogin = document.getElementById("tab-login");
    const tabSignup = document.getElementById("tab-signup");
    if (tabLogin) tabLogin.classList.toggle("active", isLogin);
    if (tabSignup) tabSignup.classList.toggle("active", !isLogin);

    const confirmGroup = document.getElementById("confirm-pwd-group");
    if (confirmGroup) confirmGroup.style.display = isLogin ? "none" : "block";

    const submitBtn = document.getElementById("auth-submit-btn") || document.getElementById("btn-auth-submit");
    if (submitBtn) submitBtn.innerText = isLogin ? "로그인하고 기획 시작하기" : "회원가입 완료";

    const errorEl = document.getElementById("auth-error-msg");
    if (errorEl) errorEl.innerText = "";
}

async function handleAuthSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const userEl = document.getElementById("username") || document.getElementById("auth-username");
    const passEl = document.getElementById("password") || document.getElementById("auth-password");
    const confEl = document.getElementById("confirm-password");
    const errorEl = document.getElementById("auth-error-msg");

    const usernameInput = userEl ? userEl.value.trim() : "";
    const passwordInput = passEl ? passEl.value.trim() : "";
    const confirmInput = confEl ? confEl.value.trim() : "";

    if (errorEl) errorEl.innerText = "";

    if (usernameInput.length < 3) {
        if (errorEl) errorEl.innerText = "아이디는 3자 이상이어야 합니다.";
        return;
    }
    if (passwordInput.length < 4) {
        if (errorEl) errorEl.innerText = "비밀번호는 4자 이상이어야 합니다.";
        return;
    }

    try {
        if (currentAuthTab === "signup") {
            if (confEl && passwordInput !== confirmInput) {
                if (errorEl) errorEl.innerText = "비밀번호가 일치하지 않습니다.";
                return;
            }
            await ApiService.signup(usernameInput, passwordInput);
            showToast("회원가입 완료! 로그인해 주세요. 🎉");
            switchAuthTab("login");
        } else {
            await ApiService.login(usernameInput, passwordInput);
            showToast("환영합니다! 🎬 로그인되었습니다.");
            closeAuthModal();
            checkAuthState();
            loadChatHistory();
        }
    } catch (err) {
        if (errorEl) errorEl.innerText = err.message || "인증 처리 중 오류가 발생했습니다.";
    }
}

function enterAsGuest() {
    ApiService.setToken("guest-token-" + Date.now(), "게스트 크리에이터");
    showToast("게스트 모드로 시작합니다! 🎬 기획을 둘러보세요.");
    closeAuthModal();
    checkAuthState();
    loadChatHistory();
}

function continueAsGuest() {
    enterAsGuest();
}

function handleLogout() {
    ApiService.clearToken();
    showToast("로그아웃 되었습니다.");
    checkAuthState();
    loadChatHistory();
}

function logout() {
    handleLogout();
}

function openDbModal() {
    openDbLogModal();
}

function closeDbModal() {
    const modal = document.getElementById("db-modal") || document.getElementById("db-log-modal");
    if (modal) modal.style.display = "none";
}

// 2. 대화 로그 및 DB 추적 모달 (과제 4번 요구사항 실현)
async function openDbLogModal() {
    const modal = document.getElementById("db-modal") || document.getElementById("db-log-modal");
    if (!modal) return;
    modal.style.display = "flex";
    await renderDbLogs();
}

function closeDbLogModal() {
    const modal = document.getElementById("db-modal") || document.getElementById("db-log-modal");
    if (modal) modal.style.display = "none";
}

function switchDbTab(tab) {
    currentDbTab = tab;
    const isLogs = tab === "logs";
    const tab1 = document.getElementById("db-tab-logs") || document.getElementById("tab-user-logs");
    const tab2 = document.getElementById("db-tab-sessions") || document.getElementById("tab-sql-guide");
    if (tab1) tab1.classList.toggle("active", isLogs);
    if (tab2) tab2.classList.toggle("active", !isLogs);

    const panel1 = document.getElementById("panel-user-logs");
    const panel2 = document.getElementById("panel-sql-guide");
    if (panel1) panel1.classList.toggle("active", isLogs);
    if (panel2) panel2.classList.toggle("active", !isLogs);

    renderDbLogs();
}

async function renderDbLogs() {
    const tbody = document.getElementById("db-table-body") || document.getElementById("db-log-tbody");
    if (!tbody) return;

    try {
        const logs = await ApiService.getMyHistory();
        tbody.innerHTML = "";

        if (!logs || logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:24px; color:#94A3B8;">기록된 DB 대화 로그가 없습니다. 새 릴스 기획을 시작해 보세요!</td></tr>`;
            return;
        }

        logs.forEach(log => {
            const tr = document.createElement("tr");
            const timeStr = log.created_at ? new Date(log.created_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "방금 전";
            const promptSummary = log.prompt ? (log.prompt.length > 28 ? log.prompt.substring(0, 28) + "..." : log.prompt) : "(내용 없음)";
            const statusBadge = log.status || "200 OK / DB_SAVED";

            tr.innerHTML = `
                <td style="font-size:11.5px; color:#64748B;">${log.id ? log.id.substring(0, 8) : "LOG"}</td>
                <td style="font-weight:700; color:#0F172A;">${escapeHtml(promptSummary)}</td>
                <td><span style="font-size:11px; background:#F1F5F9; color:#0D9488; padding:3px 8px; border-radius:9999px; font-weight:700;">${statusBadge}</span></td>
                <td style="font-size:12px; color:#64748B;">${timeStr}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px; color:#E11D48;">로그를 불러오지 못했습니다.</td></tr>`;
    }
}

function clearDbLogs() {
    if (confirm("모든 로컬 대화 로그를 초기화하시겠습니까?")) {
        localStorage.removeItem("chat_history");
        renderDbLogs();
        loadChatHistory();
        showToast("🧹 DB 대화 로그가 초기화되었습니다.");
    }
}

function loadLogIntoChat(logId) {
    closeDbLogModal();
    const item = document.querySelector(`.history-item[data-chat-id="${logId}"]`);
    if (item) item.click();
}

function copySqlSnippet() {
    const sql = `-- [사용자별 대화 로그 추적 쿼리]
SELECT id, user_id, prompt, response, latency_ms, created_at 
FROM chat_logs 
ORDER BY created_at DESC 
LIMIT 10;

-- [핵심 이벤트 감사 로그 조회]
SELECT * FROM audit_logs WHERE event_type IN ('ai_call_success', 'db_save_success');`;

    navigator.clipboard.writeText(sql).then(() => {
        showToast("SQL 쿼리가 클립보드에 복사되었습니다! 📋");
    });
}

// 3. 사이드바 열고 닫기 (토글)
function toggleSidebar() {
    const sidebar = document.getElementById("app-sidebar");
    const openBtn = document.getElementById("btn-open-sidebar");
    if (!sidebar) return;

    sidebar.classList.toggle("collapsed");
    const isCollapsed = sidebar.classList.contains("collapsed");

    if (openBtn) {
        openBtn.style.display = isCollapsed ? "flex" : "none";
    }
}

// 4. 히스토리 로드 및 현재 활성 대화 하이라이트
async function loadChatHistory() {
    try {
        const history = await ApiService.getMyHistory();
        const historyList = document.getElementById("history-list");
        const countBadge = document.getElementById("history-count");

        if (!historyList) return;
        historyList.innerHTML = "";
        if (countBadge) countBadge.innerText = history ? history.length : 0;

        if (!history || history.length === 0) {
            historyList.innerHTML = `<li style="font-size:12px; color:#94A3B8; padding:10px;">저장된 기획안이 없습니다.</li>`;
            return;
        }

        history.forEach((item) => {
            const li = document.createElement("li");
            li.className = "history-item";
            li.dataset.chatId = item.id;
            li.innerText = item.prompt;
            li.title = item.prompt;

            if (currentActiveChatId === item.id) {
                li.classList.add("active");
            }

            li.onclick = () => {
                selectChatHistory(item);
            };
            historyList.appendChild(li);
        });
    } catch (e) {
        console.error("히스토리 로드 오류:", e);
    }
}

function selectChatHistory(item) {
    currentActiveChatId = item.id;

    document.querySelectorAll(".history-item").forEach(el => {
        el.classList.toggle("active", el.dataset.chatId === item.id);
    });

    const titleEl = document.getElementById("session-title-text");
    if (titleEl) {
        titleEl.innerText = `🎬 ${item.prompt.substring(0, 22)}...`;
    }

    const chatContainer = document.getElementById("chat-messages");
    chatContainer.innerHTML = "";
    appendMessage("user", item.prompt);
    appendMessage("ai", item.response);

    showToast(`'${item.prompt.substring(0, 15)}...' 대본을 불러왔습니다.`);
}

// 새로운 세션 만들기 (UX 극대화: 릴리 웰컴 히어로 뷰 복원)
function startNewChat() {
    currentActiveChatId = null;
    document.querySelectorAll(".history-item").forEach(el => el.classList.remove("active"));

    const titleEl = document.getElementById("session-title-text");
    if (titleEl) titleEl.innerText = "🎬 릴스 대본 기획 세션";

    const chatContainer = document.getElementById("chat-messages");
    chatContainer.innerHTML = `
        <div class="welcome-hero-container">
            <div class="hero-mascot-box" onclick="triggerMascotClick()" title="릴리를 클릭해 보세요! ✨">
                <svg class="lilly-hero-svg" viewBox="0 0 120 120" width="88" height="88">
                    <circle class="halo-ring" cx="60" cy="60" r="54" fill="none" stroke="#818CF8" stroke-width="2.5" stroke-dasharray="6 4" opacity="0.7"/>
                    <circle cx="60" cy="60" r="48" fill="#EEF2FF" stroke="#6366F1" stroke-width="3"/>
                    <rect class="slate-bar" x="38" y="14" width="44" height="15" rx="3.5" fill="#4F46E5"/>
                    <line x1="48" y1="14" x2="53" y2="29" stroke="#FFF" stroke-width="2.2"/>
                    <line x1="60" y1="14" x2="65" y2="29" stroke="#FFF" stroke-width="2.2"/>
                    <line x1="72" y1="14" x2="77" y2="29" stroke="#FFF" stroke-width="2.2"/>
                    <circle cx="60" cy="65" r="32" fill="#FFFFFF" stroke="#E0E7FF" stroke-width="1.8"/>
                    <ellipse class="lilly-eye eye-left" cx="49" cy="64" rx="4" ry="5.5" fill="#1E1B4B"/>
                    <ellipse class="lilly-eye eye-right" cx="71" cy="64" rx="4" ry="5.5" fill="#1E1B4B"/>
                    <circle cx="50" cy="62" r="1.8" fill="#FFF"/>
                    <circle cx="72" cy="62" r="1.8" fill="#FFF"/>
                    <circle cx="43" cy="71" r="5" fill="#F472B6" opacity="0.75"/>
                    <circle cx="77" cy="71" r="5" fill="#F472B6" opacity="0.75"/>
                    <path d="M53 74 Q60 83 67 74" stroke="#1E1B4B" stroke-width="2.8" fill="none" stroke-linecap="round"/>
                    <polygon class="sparkle-star" points="98,28 100,34 106,36 100,38 98,44 96,38 90,36 96,34" fill="#F59E0B"/>
                    <polygon class="sparkle-star-sm" points="22,46 23,50 27,51 23,52 22,56 21,52 17,51 21,50" fill="#EC4899"/>
                </svg>
            </div>

            <h2 class="hero-title">어떤 릴스 대본을 기획해 볼까요?</h2>
            <p class="hero-subtitle">아이디어 한 줄만 주시면 <strong>3초 킬링훅부터 씬별 카메라 연출</strong>까지 실시간으로 기획해 드려요 ✨</p>

            <div class="starter-cards-grid">
                <div class="starter-card" onclick="applyTemplate(null, '3초 안에 시선 잡는 인스타 릴스 꿀팁 영상 기획해 줘')">
                    <div class="starter-card-top">
                        <span class="card-icon">⚡</span>
                        <span class="card-tag">바이럴 훅</span>
                    </div>
                    <h4 class="card-title">3초 꿀팁 릴스</h4>
                    <p class="card-desc">시청 이탈을 원천 차단하는 강력한 첫 씬 연출</p>
                </div>

                <div class="starter-card" onclick="applyTemplate(null, '다이어트 직장인 현실 공감 30초 릴스 대본 짜 줘')">
                    <div class="starter-card-top">
                        <span class="card-icon">🥗</span>
                        <span class="card-tag">현실 공감</span>
                    </div>
                    <h4 class="card-title">현실 공감 브이로그</h4>
                    <p class="card-desc">직장인 1인칭 시점의 30초 현실 밀착 스토리</p>
                </div>

                <div class="starter-card" onclick="applyTemplate(null, '개발자 숏폼: 초보자가 매일 하는 실수 TOP 3 기획')">
                    <div class="starter-card-top">
                        <span class="card-icon">💻</span>
                        <span class="card-tag">정보 전달</span>
                    </div>
                    <h4 class="card-title">초보 실수 TOP 3</h4>
                    <p class="card-desc">저장과 공유를 부르는 3단계 꿀팁 정보형 숏폼</p>
                </div>

                <div class="starter-card" onclick="applyTemplate(null, '인스타 알고리즘 떡상하는 치트키 3가지 릴스')">
                    <div class="starter-card-top">
                        <span class="card-icon">📈</span>
                        <span class="card-tag">알고리즘</span>
                    </div>
                    <h4 class="card-title">떡상 치트키 릴스</h4>
                    <p class="card-desc">조회수와 팔로워를 급상승시키는 공식 대본</p>
                </div>
            </div>
        </div>
    `;

    const textarea = document.getElementById("user-input");
    if (textarea) {
        textarea.value = "";
        document.getElementById("char-count").innerText = "0";
        autoResize(textarea);
        textarea.focus();
    }
    showToast("새 기획 세션이 시작되었습니다. ✨");
}

// 5. 메시지 전송 & 실시간 더미 스트리밍 파이프라인
async function sendMessage() {
    const token = localStorage.getItem("access_token");
    if (!token) {
        showToast("🔒 릴스 기획은 로그인 후 이용 가능합니다.");
        openAuthModal("login");
        return;
    }

    if (isGenerating) {
        if (activeStreamController) {
            activeStreamController.abort();
            showToast("대본 기획 생성을 중단했습니다.");
        }
        finishGeneration();
        return;
    }

    const textarea = document.getElementById("user-input");
    const prompt = textarea.value.trim();

    if (!prompt) {
        showToast("기획할 영상 주제나 상황을 입력해 주세요! 💡");
        textarea.focus();
        return;
    }
    if (prompt.length > 1000) {
        showToast("1,000자 이내로 입력해 주세요.");
        return;
    }

    const hero = document.querySelector(".welcome-hero-container");
    if (hero) hero.remove();

    const titleEl = document.getElementById("session-title-text");
    if (titleEl) {
        titleEl.innerText = `🎬 ${prompt.substring(0, 22)}...`;
    }

    const duration = document.getElementById("select-duration") ? document.getElementById("select-duration").value : "30s";
    const tone = document.getElementById("select-tone") ? document.getElementById("select-tone").value : "viral";

    appendMessage("user", prompt);
    textarea.value = "";
    document.getElementById("char-count").innerText = "0";
    autoResize(textarea);

    isGenerating = true;
    lastFailedPrompt = prompt;
    setMascotThinking(true);
    updateSendButtonState(true);

    const loadingId = appendLoadingBubble();

    try {
        let streamCardInitiated = false;
        let streamTextEl = null;
        let cursorEl = null;

        activeStreamController = ApiService.sendChatStream(
            prompt,
            { duration, tone },
            // 1) 실시간 청크 수신
            (chunk, fullText) => {
                if (!streamCardInitiated) {
                    removeMessage(loadingId);
                    const chatContainer = document.getElementById("chat-messages");
                    const row = document.createElement("div");
                    row.className = "message-row ai";
                    row.innerHTML = `
                        ${LILLY_AVATAR_HTML}
                        <div class="message-bubble" style="width: 100%;">
                            <div class="script-card">
                                <div class="script-header-bar">
                                    <span class="script-tag-title">
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                                        실시간 대본 스트리밍 기획 중...
                                    </span>
                                    <div class="script-actions-group">
                                        <button class="btn-card-action" onclick="copyScript(this)">📋 복사</button>
                                        <button class="btn-card-action" onclick="downloadScript(this)">💾 저장</button>
                                    </div>
                                </div>
                                <div class="script-content-body"><span class="stream-text"></span><span class="typing-cursor"></span></div>
                            </div>
                        </div>
                    `;
                    chatContainer.appendChild(row);
                    streamTextEl = row.querySelector(".stream-text");
                    cursorEl = row.querySelector(".typing-cursor");
                    streamCardInitiated = true;
                }

                if (streamTextEl) {
                    streamTextEl.innerText = fullText;
                    const viewport = document.querySelector(".chat-viewport");
                    if (viewport) viewport.scrollTop = viewport.scrollHeight;
                }
            },
            // 2) 스트리밍 완성 시
            (finalText) => {
                if (cursorEl) cursorEl.remove();
                const tagEl = document.querySelector(".script-tag-title");
                if (tagEl) {
                    tagEl.innerHTML = `<span>🎬 릴스 기획 콘티 완성</span>`;
                }
                finishGeneration();
                loadChatHistory();
                createConfettiEffect(window.innerWidth / 2, 80);
                showToast("대본 기획이 성공적으로 완성되었습니다! 🎉");
            },
            // 3) 에러 시 (과제 제약: 비정상 종료 방지 및 사용자 안내)
            (err) => {
                removeMessage(loadingId);
                appendErrorMessage(err.message || "응답 생성 중 오류가 발생했습니다. (error: AI_TIMEOUT)");
                finishGeneration();
            }
        );
    } catch (e) {
        removeMessage(loadingId);
        appendErrorMessage(e.message || "요청 처리 중 오류가 발생했습니다. (error: AI_TIMEOUT)");
        finishGeneration();
    }
}

function updateSendButtonState(generating) {
    const btn = document.getElementById("btn-send");
    const btnText = document.getElementById("btn-send-text");
    const btnIcon = document.getElementById("btn-send-icon");

    if (generating) {
        btn.classList.add("btn-stop");
        btnText.innerText = "기획 중단";
        btnIcon.innerHTML = `<rect x="6" y="6" width="12" height="12" fill="currentColor"/>`;
    } else {
        btn.classList.remove("btn-stop");
        btnText.innerText = "대본 기획 시작";
        btnIcon.innerHTML = `<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>`;
    }
}

function finishGeneration() {
    isGenerating = false;
    activeStreamController = null;
    setMascotThinking(false);
    updateSendButtonState(false);
}

// 6. 화면 렌더링 헬퍼 함수
function appendMessage(sender, text) {
    const chatContainer = document.getElementById("chat-messages");
    const row = document.createElement("div");
    row.className = `message-row ${sender}`;

    if (sender === "user") {
        row.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
    } else {
        row.innerHTML = `
            ${LILLY_AVATAR_HTML}
            <div class="message-bubble" style="width: 100%;">
                <div class="script-card">
                    <div class="script-header-bar">
                        <span class="script-tag-title">🎬 릴스 기획 대본</span>
                        <div class="script-actions-group">
                            <button class="btn-card-action" onclick="copyScript(this)">📋 복사</button>
                            <button class="btn-card-action" onclick="downloadScript(this)">💾 저장</button>
                        </div>
                    </div>
                    <div class="script-content-body">${escapeHtml(text)}</div>
                </div>
            </div>
        `;
    }
    chatContainer.appendChild(row);
    const viewport = document.querySelector(".chat-viewport");
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
}

function appendErrorMessage(msg) {
    const chatContainer = document.getElementById("chat-messages");
    const row = document.createElement("div");
    row.className = "message-row ai";
    row.innerHTML = `
        ${LILLY_AVATAR_HTML}
        <div class="message-bubble" style="width: 100%;">
            <div class="error-notice-card">
                <p><strong>⚠️ 현재 AI 응답이 지연되고 있습니다.</strong></p>
                <p style="font-size:12.5px; margin-top:4px;">${escapeHtml(msg)}</p>
                <button class="btn-retry" onclick="retryLastPrompt()">🔄 다시 시도하기</button>
            </div>
        </div>
    `;
    chatContainer.appendChild(row);
    const viewport = document.querySelector(".chat-viewport");
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
}

function retryLastPrompt() {
    if (lastFailedPrompt) {
        const textarea = document.getElementById("user-input");
        textarea.value = lastFailedPrompt;
        sendMessage();
    }
}

function appendLoadingBubble() {
    const id = "loading-" + Date.now();
    const chatContainer = document.getElementById("chat-messages");
    const row = document.createElement("div");
    row.id = id;
    row.className = "message-row ai";
    row.innerHTML = `
        ${LILLY_AVATAR_HTML}
        <div class="message-bubble">
            <div class="loading-thinking-box">
                <div class="loading-dots">
                    <span></span><span></span><span></span>
                </div>
                <span>릴리가 바이럴 훅과 씬 구성을 연출하고 있어요...</span>
            </div>
        </div>
    `;
    chatContainer.appendChild(row);
    const viewport = document.querySelector(".chat-viewport");
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
    return id;
}

function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

// 7. 마스코트 상호작용 (캐릭터 모션 + 대사 말풍선 + 폭죽 파티클)
function triggerMascotClick(event) {
    // 모든 릴리 마스코트 SVG 점프 스핀 애니메이션
    const mascots = document.querySelectorAll(".lilly-mascot-svg, .lilly-hero-svg, #main-mascot");
    mascots.forEach(m => {
        m.classList.remove("jump-spin");
        void m.offsetWidth; // 리플로우 강제
        m.classList.add("jump-spin");
    });

    // 클릭 위치 폭죽 파티클
    const clickX = (event && event.clientX) ? event.clientX : (window.innerWidth / 2);
    const clickY = (event && event.clientY) ? event.clientY : 180;
    createConfettiEffect(clickX, clickY);

    // 릴리의 풍부한 숏폼/릴스 꿀팁 대사 풀
    const quotes = [
        "릴리: '3초 안에 시선을 뺏는 첫 씬이 바이럴의 90%예요! 🎬'",
        "릴리: '호기심을 자극하는 질문형 훅으로 시작하면 이탈율이 확 줄어요! ✨'",
        "릴리: '시청자가 끝까지 보게 만드는 반전 복선을 심어드릴게요! 🚀'",
        "릴리: '저장하고 나중에 다시 보게 만드는 체크리스트를 넣으세요! 💾'",
        "릴리: '댓글을 부르는 찬반 질문 CTA를 마지막 컷에 배치해 보세요! 💬'",
        "릴리: '지금 인스타 트렌드 탭에서 급상승 중인 릴스 음원을 입혀보세요! 🎵'",
        "릴리: '궁금한 아이디어를 아래 입력창에 편하게 한 줄만 적어주세요! 💡'",
        "릴리: '대본이 완성되면 복사 버튼으로 캡컷에 바로 붙여넣을 수 있어요! 📋'"
    ];
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];

    // 1) 토스트 메시지 발화
    showToast(randomQuote);

    // 2) 웰컴 히어로 및 사이드바 마스코트 머리 위에 직접 말풍선 띄우기
    showMascotSpeechBubble(randomQuote.replace(/^릴리:\s*['"]?/, "").replace(/['"]?$/, ""));

    // 감정 배지 하트 모션
    const badges = document.querySelectorAll(".mascot-badge-dot, #mascot-emotion-badge");
    badges.forEach(b => {
        b.innerText = "💖";
        setTimeout(() => { b.innerText = "🎬"; }, 1600);
    });
}

// 마스코트 머리 위 말풍선 툴팁 팝업 (머리 위 정중앙 발화)
function showMascotSpeechBubble(text) {
    const wrap = document.querySelector(".hero-avatar-wrap") || document.querySelector(".hero-mascot-box");
    if (wrap) {
        let bubble = wrap.querySelector(".lilly-speech-bubble");
        if (!bubble) {
            bubble = document.createElement("div");
            bubble.className = "lilly-speech-bubble";
            wrap.style.position = "relative";
            wrap.appendChild(bubble);
        }
        bubble.innerText = text;
        bubble.classList.remove("show");
        void bubble.offsetWidth;
        bubble.classList.add("show");
        setTimeout(() => { bubble.classList.remove("show"); }, 3400);
    }
}

function setMascotThinking(isThinking) {
    const mascot = document.getElementById("main-mascot");
    const desc = document.getElementById("mascot-status-desc");
    const badge = document.getElementById("mascot-emotion-badge");

    if (!mascot) return;

    if (isThinking) {
        mascot.classList.add("thinking-pulse");
        if (desc) desc.innerText = "아이디어 딥-띵킹 분석 중... 🧠⚡";
        if (badge) badge.innerText = "⚡";
    } else {
        mascot.classList.remove("thinking-pulse");
        if (desc) desc.innerText = "숏폼 기획 디렉터";
        if (badge) badge.innerText = "🎬";
    }
}

// 8. 부가 도구 (프롬프트 다듬기, 템플릿 카드 클릭, 복사, 다운로드)
function enhancePromptWithMagic() {
    const textarea = document.getElementById("user-input");
    const curVal = textarea.value.trim();

    const samplePrompts = [
        "직장인 아침 10분 만에 끝내는 초간단 다이어트 도시락 레시피와 칼로리 절약 꿀팁",
        "인스타그램 릴스에서 3초 만에 이탈 막고 저장 폭발시키는 훅(Hook) 기획",
        "초보 개발자가 코딩 공부할 때 90%가 하는 치명적인 실수 3가지와 해결책",
        "퇴근 후 30분 투자해서 월 100만원 부수입 만드는 현실적인 루틴 대본"
    ];

    if (!curVal) {
        const picked = samplePrompts[Math.floor(Math.random() * samplePrompts.length)];
        textarea.value = picked;
    } else {
        textarea.value = `[바이럴 떡상 타겟] ${curVal} - 시청자가 무조건 끝까지 보고 댓글 남기게 만드는 릴스 대본 짜 줘`;
    }

    document.getElementById("char-count").innerText = textarea.value.length;
    autoResize(textarea);
    textarea.focus();
    showToast("✨ 프롬프트를 바이럴 릴스에 최적화하여 다듬었습니다!");
}

function applyTemplate(chipBtn, text) {
    if (typeof chipBtn === "string" && !text) {
        text = chipBtn;
    }
    const textarea = document.getElementById("user-input");
    if (!textarea) return;
    textarea.value = text;
    const countEl = document.getElementById("char-count");
    if (countEl) countEl.innerText = text.length;
    autoResize(textarea);
    textarea.focus();
    showToast("💡 추천 훅 템플릿이 입력창에 적용되었습니다.");
}

function copyScript(btn) {
    const card = btn.closest(".script-card");
    const content = card.querySelector(".script-content-body").innerText;

    navigator.clipboard.writeText(content).then(() => {
        showToast("📋 대본이 클립보드에 복사되었습니다! 🎉");
    }).catch(() => {
        const ta = document.createElement("textarea");
        ta.value = content;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        showToast("📋 대본이 클립보드에 복사되었습니다! 🎉");
    });
}

function downloadScript(btn) {
    const card = btn.closest(".script-card");
    const content = card.querySelector(".script-content-body").innerText;

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Lilly_Reels_Script_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("💾 대본 파일(.txt)이 다운로드되었습니다.");
}

function autoResize(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 130) + "px";
    document.getElementById("char-count").innerText = textarea.value.length;
}

function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

let toastTimer = null;
function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;

    toast.innerText = message;
    toast.classList.add("show");

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2800);
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.innerText = text;
    return div.innerHTML;
}

function createConfettiEffect(x, y) {
    const container = document.getElementById("particle-container");
    if (!container) return;

    const colors = ["#5448ED", "#FF3366", "#F59E0B", "#059669", "#7E73F8"];
    for (let i = 0; i < 28; i++) {
        const particle = document.createElement("div");
        particle.style.position = "absolute";
        particle.style.left = `${x}px`;
        particle.style.top = `${y}px`;
        particle.style.width = `${Math.random() * 8 + 4}px`;
        particle.style.height = `${Math.random() * 8 + 4}px`;
        particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        particle.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
        particle.style.zIndex = "99999";
        particle.style.pointerEvents = "none";
        container.appendChild(particle);

        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * 120 + 50;
        const vx = Math.cos(angle) * velocity;
        const vy = Math.sin(angle) * velocity;

        let startTime = performance.now();
        function animate(now) {
            const elapsed = (now - startTime) / 1000;
            if (elapsed > 0.8) {
                particle.remove();
                return;
            }
            particle.style.transform = `translate(${vx * elapsed}px, ${vy * elapsed + 160 * elapsed * elapsed}px) rotate(${elapsed * 720}deg)`;
            particle.style.opacity = `${1 - elapsed / 0.8}`;
            requestAnimationFrame(animate);
        }
        requestAnimationFrame(animate);
    }
}