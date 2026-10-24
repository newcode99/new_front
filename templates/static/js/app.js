/**
 * app.js: 릴리(Lilly) AI 인터랙션, 실시간 탑바 상태 머신,
 * 실시간 입력 유효성 검증 & 비밀번호 강도, 히스토리 수명주기 관리 및 UX 고도화
 */

let currentAuthTab = "login";
let currentDbTab = "logs";
let isGenerating = false;
let activeStreamController = null;
let currentActiveChatId = null;
let lastFailedPrompt = null;
let typingDebounceTimer = null;

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
    setLillyHeaderStatus("idle");
});

// 키보드 단축키 및 모달/오버레이 글로벌 이벤트 바인딩
function setupShortcuts() {
    window.addEventListener("keydown", (e) => {
        // 사이드바 토글 (Ctrl+B / Cmd+B)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
            e.preventDefault();
            toggleSidebar();
        }
        // ESC 키로 열린 모달 닫기
        if (e.key === "Escape") {
            closeAuthModal();
            closeDbModal();
            closeSidebarMobile();
        }
    });

    // 모달 배경 클릭 시 닫기 바인딩
    ["auth-modal", "db-modal"].forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.addEventListener("click", (e) => {
                if (e.target === modal) {
                    if (modalId === "auth-modal") closeAuthModal();
                    if (modalId === "db-modal") closeDbModal();
                }
            });
        }
    });

    // 화면 크기 변경 시 상태 자동 보정
    window.addEventListener("resize", () => {
        const sidebar = document.getElementById("sidebar") || document.getElementById("app-sidebar");
        const backdrop = document.getElementById("sidebar-backdrop");
        if (window.innerWidth > 900) {
            if (sidebar) sidebar.classList.remove("open");
            if (backdrop) backdrop.classList.remove("active");
            document.body.classList.remove("sidebar-open");
        }
    });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   1. [핵심 고도화] 일반 헤더(상단 탑바) 실시간 릴리 AI 상태 머신
   상태: idle (대기) | typing (입력 감지) | generating (기획 연출 중) | streaming (작성 중) | complete (완성)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function setLillyHeaderStatus(status, customText = null) {
    const statusPill = document.getElementById("topbar-lilly-live-status");
    const statusText = document.getElementById("topbar-status-text");
    const statusStage = document.getElementById("topbar-status-stage");
    const sidebarStatus = document.getElementById("mascot-status-desc");
    const sidebarBadge = document.getElementById("mascot-emotion-badge");

    if (!statusPill) return;

    // 모든 상태 클래스 리셋
    statusPill.classList.remove("idle", "typing", "generating", "complete");

    switch (status) {
        case "typing":
            statusPill.classList.add("typing");
            if (statusText) statusText.innerText = customText || "크리에이터 아이디어 감지 중...";
            if (statusStage) statusStage.innerText = "INPUT";
            if (sidebarStatus) sidebarStatus.innerText = "아이디어 청취 중... ✍️";
            if (sidebarBadge) sidebarBadge.innerText = "✍️";
            break;

        case "generating":
            statusPill.classList.add("generating");
            if (statusText) statusText.innerText = customText || "릴리가 3초 킬링훅 연출 중...";
            if (statusStage) statusStage.innerText = "PLANNING";
            if (sidebarStatus) sidebarStatus.innerText = "콘티 딥-띵킹 연출 중... 🧠⚡";
            if (sidebarBadge) sidebarBadge.innerText = "⚡";
            break;

        case "streaming":
            statusPill.classList.add("generating");
            if (statusText) statusText.innerText = customText || "씬별 대본 및 카메라 앵글 작성 중...";
            if (statusStage) statusStage.innerText = "STREAMING";
            if (sidebarStatus) sidebarStatus.innerText = "실시간 스트리밍 집필 중... 🎬";
            if (sidebarBadge) sidebarBadge.innerText = "🎬";
            break;

        case "complete":
            statusPill.classList.add("complete");
            if (statusText) statusText.innerText = customText || "30초 바이럴 릴스 기획 완성! ✨";
            if (statusStage) statusStage.innerText = "READY";
            if (sidebarStatus) sidebarStatus.innerText = "기획안 제작 완료 🎉";
            if (sidebarBadge) sidebarBadge.innerText = "🎉";
            break;

        case "idle":
        default:
            statusPill.classList.add("idle");
            if (statusText) statusText.innerText = customText || "릴리 대기 중 · 기획 준비 완료";
            if (statusStage) statusStage.innerText = "IDLE";
            if (sidebarStatus) sidebarStatus.innerText = "숏폼 기획 디렉터";
            if (sidebarBadge) sidebarBadge.innerText = "🎬";
            break;
    }
}

// 텍스트에어리어 실시간 입력 감지 핸들러 (타이핑 시 릴리 상태 연동 & 글자 수 카운팅)
function handleInputLive(textarea) {
    if (!textarea) return;
    autoResize(textarea);

    const val = textarea.value.trim();
    const countEl = document.getElementById("char-count");
    if (countEl) countEl.innerText = textarea.value.length;

    // 생성 중이 아닐 때만 타이핑 상태 머신 반응
    if (!isGenerating) {
        if (val.length > 0) {
            setLillyHeaderStatus("typing");
            if (typingDebounceTimer) clearTimeout(typingDebounceTimer);
            typingDebounceTimer = setTimeout(() => {
                if (!isGenerating && textarea.value.trim().length > 0) {
                    setLillyHeaderStatus("idle", "릴리 아이디어 수신 완료 · 기획 대기 중");
                } else if (!isGenerating) {
                    setLillyHeaderStatus("idle");
                }
            }, 1800);
        } else {
            if (typingDebounceTimer) clearTimeout(typingDebounceTimer);
            setLillyHeaderStatus("idle");
        }
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   2. [핵심 고도화] 로그인/회원가입 팝업 실시간 폼 유효성 & 비밀번호 강도 상태 처리
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

// 아이디 실시간 유효성 검사
function validateUsernameLive() {
    const input = document.getElementById("username");
    const feedback = document.getElementById("username-feedback");
    const statusIcon = document.getElementById("username-status-icon");
    if (!input) return false;

    const val = input.value.trim();
    const isValid = /^[a-zA-Z0-9_]{3,20}$/.test(val);

    if (val.length === 0) {
        input.classList.remove("valid", "invalid");
        if (feedback) { feedback.innerText = ""; feedback.className = "field-feedback-text"; }
        if (statusIcon) { statusIcon.innerText = ""; statusIcon.className = "input-status-icon"; }
        return false;
    }

    if (isValid) {
        input.classList.add("valid");
        input.classList.remove("invalid");
        if (feedback) {
            feedback.innerText = "사용 가능한 멋진 아이디입니다 ✨";
            feedback.className = "field-feedback-text valid";
        }
        if (statusIcon) {
            statusIcon.innerText = "✓";
            statusIcon.className = "input-status-icon valid";
        }
        return true;
    } else {
        input.classList.add("invalid");
        input.classList.remove("valid");
        if (feedback) {
            feedback.innerText = "영문/숫자 조합 3자 이상 입력해 주세요.";
            feedback.className = "field-feedback-text invalid";
        }
        if (statusIcon) {
            statusIcon.innerText = "✕";
            statusIcon.className = "input-status-icon invalid";
        }
        return false;
    }
}

// 비밀번호 실시간 유효성 및 보안 강도 계산
function validatePasswordLive() {
    const input = document.getElementById("password");
    const feedback = document.getElementById("password-feedback");
    const strengthWrap = document.getElementById("password-strength-wrap");
    const strengthFill = document.getElementById("strength-bar-fill");
    const strengthLabel = document.getElementById("strength-label");
    if (!input) return false;

    const val = input.value;
    const isValid = val.length >= 4;

    if (val.length === 0) {
        input.classList.remove("valid", "invalid");
        if (feedback) { feedback.innerText = ""; feedback.className = "field-feedback-text"; }
        if (strengthFill) { strengthFill.className = "strength-bar-fill"; strengthFill.style.width = "0%"; }
        if (strengthLabel) strengthLabel.innerText = "보안 수준: 입력 대기";
        return false;
    }

    // 기본 유효성
    if (isValid) {
        input.classList.add("valid");
        input.classList.remove("invalid");
        if (feedback) {
            feedback.innerText = "적절한 비밀번호입니다 ✨";
            feedback.className = "field-feedback-text valid";
        }
    } else {
        input.classList.add("invalid");
        input.classList.remove("valid");
        if (feedback) {
            feedback.innerText = "4자 이상 입력해 주세요.";
            feedback.className = "field-feedback-text invalid";
        }
    }

    // 비밀번호 강도(Strength) 평가 (회원가입 탭에서 주로 활용)
    if (strengthWrap) {
        let score = 0;
        if (val.length >= 4) score += 1;
        if (val.length >= 8) score += 1;
        if (/[0-9]/.test(val) && /[a-zA-Z]/.test(val)) score += 1;
        if (/[^a-zA-Z0-9]/.test(val)) score += 1;

        if (strengthFill && strengthLabel) {
            strengthFill.className = "strength-bar-fill";
            if (score <= 1) {
                strengthFill.classList.add("weak");
                strengthFill.style.width = "33%";
                strengthLabel.innerText = "보안 수준: 약함 (영문/숫자 혼합 추천)";
            } else if (score === 2 || score === 3) {
                strengthFill.classList.add("medium");
                strengthFill.style.width = "66%";
                strengthLabel.innerText = "보안 수준: 보통 (특수문자 추가 시 더 안전)";
            } else {
                strengthFill.classList.add("strong");
                strengthFill.style.width = "100%";
                strengthLabel.innerText = "보안 수준: 강력함 ✨ (완벽한 보안)";
            }
        }
    }

    // 비밀번호 확인 입력창이 이미 채워져 있다면 일치 여부도 즉시 재검증
    const confirmInput = document.getElementById("confirm-password");
    if (confirmInput && confirmInput.value.length > 0) {
        validateConfirmPasswordLive();
    }

    return isValid;
}

// 비밀번호 확인 실시간 일치 여부 검증
function validateConfirmPasswordLive() {
    const pwdInput = document.getElementById("password");
    const confInput = document.getElementById("confirm-password");
    const confFeedback = document.getElementById("confirm-feedback");
    if (!confInput) return true;

    const pwd = pwdInput ? pwdInput.value : "";
    const conf = confInput.value;

    if (conf.length === 0) {
        confInput.classList.remove("valid", "invalid");
        if (confFeedback) { confFeedback.innerText = ""; confFeedback.className = "field-feedback-text"; }
        return false;
    }

    if (pwd === conf) {
        confInput.classList.add("valid");
        confInput.classList.remove("invalid");
        if (confFeedback) {
            confFeedback.innerText = "비밀번호가 일치합니다 ✓";
            confFeedback.className = "field-feedback-text valid";
        }
        return true;
    } else {
        confInput.classList.add("invalid");
        confInput.classList.remove("valid");
        if (confFeedback) {
            confFeedback.innerText = "비밀번호가 일치하지 않습니다 ✕";
            confFeedback.className = "field-feedback-text invalid";
        }
        return false;
    }
}

// 비밀번호 보기 / 숨기기 눈 아이콘 토글
function togglePasswordVisibility(inputId, btnEl) {
    const input = document.getElementById(inputId);
    if (!input) return;

    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";

    const iconEl = btnEl ? (btnEl.querySelector(".eye-icon") || btnEl) : null;
    if (iconEl) {
        iconEl.innerText = isPassword ? "🙈" : "👁️";
    }
}

// 체험용 테스트 계정 1초 원클릭 자동 채우기
function fillDemoAccount() {
    const userInput = document.getElementById("username");
    const pwdInput = document.getElementById("password");
    const confInput = document.getElementById("confirm-password");

    if (userInput) userInput.value = "creator1";
    if (pwdInput) pwdInput.value = "pass1234";
    if (confInput && currentAuthTab === "signup") confInput.value = "pass1234";

    validateUsernameLive();
    validatePasswordLive();
    if (currentAuthTab === "signup") validateConfirmPasswordLive();

    showToast("⚡ 체험용 테스트 계정(creator1)이 자동 입력되었습니다!");
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   3. 인증 모달 제어 및 로그인 상태 반영
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function checkAuthState() {
    const token = localStorage.getItem("access_token");
    const username = localStorage.getItem("username");
    const isLoggedIn = Boolean(token && token.trim().length > 0);

    const guestActions = document.getElementById("topbar-guest-actions");
    const userActions = document.getElementById("topbar-user-actions");
    const topbarUsername = document.getElementById("topbar-username");
    const topbarAvatar = document.getElementById("topbar-user-avatar");
    const sidebarAvatar = document.getElementById("current-user-avatar");
    const sidebarUsername = document.getElementById("current-user-name");
    const sidebarStatus = document.getElementById("current-user-status");
    const loginGate = document.getElementById("login-required-overlay");

    if (isLoggedIn) {
        // [로그인 상태: 프로필 캡슐 노출 및 게이트 해제]
        const displayName = username || "Creator";
        const initial = displayName.charAt(0).toUpperCase();

        if (guestActions) guestActions.style.display = "none";
        if (userActions) userActions.style.display = "flex";
        if (topbarUsername) topbarUsername.innerText = displayName;
        if (topbarAvatar) topbarAvatar.innerText = initial;

        if (sidebarAvatar) sidebarAvatar.innerText = initial;
        if (sidebarUsername) sidebarUsername.innerText = displayName;
        if (sidebarStatus) sidebarStatus.innerText = "● 기획 모드 활성";
        if (loginGate) loginGate.style.display = "none";
    } else {
        // [비로그인 둘러보기 상태: 로그인 넛지 게이트 활성]
        if (guestActions) guestActions.style.display = "flex";
        if (userActions) userActions.style.display = "none";
        if (sidebarAvatar) sidebarAvatar.innerText = "G";
        if (sidebarUsername) sidebarUsername.innerText = "게스트 (비로그인)";
        if (sidebarStatus) sidebarStatus.innerText = "○ 로그인 필요";
        if (loginGate) loginGate.style.display = "flex";
    }
}

function openAuthModal(tab = "login") {
    switchAuthTab(tab);
    const modal = document.getElementById("auth-modal");
    if (modal) {
        modal.style.display = "flex";
        document.body.classList.add("modal-open");
        // 첫 번째 입력 필드로 자동 포커스
        setTimeout(() => {
            const input = document.getElementById("username");
            if (input) input.focus();
        }, 80);
    }
}

function closeAuthModal() {
    const modal = document.getElementById("auth-modal");
    if (modal) {
        modal.style.display = "none";
        document.body.classList.remove("modal-open");
    }
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

    const strengthWrap = document.getElementById("password-strength-wrap");
    if (strengthWrap) strengthWrap.style.display = isLogin ? "none" : "flex";

    const submitBtnText = document.getElementById("auth-btn-text");
    if (submitBtnText) submitBtnText.innerText = isLogin ? "로그인하고 기획 시작하기" : "회원가입 완료하고 시작하기";

    const errorEl = document.getElementById("auth-error-msg");
    if (errorEl) errorEl.innerText = "";
}

async function handleAuthSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();

    const usernameValid = validateUsernameLive();
    const passwordValid = validatePasswordLive();
    const confValid = currentAuthTab === "signup" ? validateConfirmPasswordLive() : true;

    const errorEl = document.getElementById("auth-error-msg");
    const submitBtn = document.getElementById("auth-submit-btn");
    const btnSpinner = document.getElementById("auth-btn-spinner");
    const btnText = document.getElementById("auth-btn-text");

    if (!usernameValid || !passwordValid || !confValid) {
        if (errorEl) errorEl.innerText = "입력 필드를 올바르게 작성해 주세요.";
        return;
    }

    const userInput = document.getElementById("username").value.trim();
    const pwdInput = document.getElementById("password").value.trim();

    // 로딩 스피너 및 중복 클릭 방지
    if (submitBtn) submitBtn.disabled = true;
    if (btnSpinner) btnSpinner.style.display = "inline-block";
    if (btnText) btnText.innerText = currentAuthTab === "signup" ? "회원가입 처리 중..." : "로그인 중...";

    try {
        if (currentAuthTab === "signup") {
            await ApiService.signup(userInput, pwdInput);
            showToast("회원가입 완료! 자동으로 로그인되었습니다. 🎉");
            await ApiService.login(userInput, pwdInput);
        } else {
            await ApiService.login(userInput, pwdInput);
            showToast("환영합니다! 🎬 로그인되었습니다.");
        }

        closeAuthModal();
        checkAuthState();
        loadChatHistory();
        setLillyHeaderStatus("idle");
    } catch (err) {
        if (errorEl) errorEl.innerText = err.message || "인증 처리 중 오류가 발생했습니다.";
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        if (btnSpinner) btnSpinner.style.display = "none";
        if (btnText) btnText.innerText = currentAuthTab === "signup" ? "회원가입 완료하고 시작하기" : "로그인하고 기획 시작하기";
    }
}

function continueAsGuest() {
    ApiService.setToken("guest-token-" + Date.now(), "게스트 크리에이터");
    showToast("게스트 모드로 시작합니다! 🎬 기획을 둘러보세요.");
    closeAuthModal();
    checkAuthState();
    loadChatHistory();
}

function logout() {
    ApiService.clearToken();
    showToast("로그아웃 되었습니다.");
    checkAuthState();
    loadChatHistory();
    startNewChat();
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   4. [핵심 고도화] 기획 히스토리 수명주기 및 개별/전체 삭제 관리
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
async function loadChatHistory() {
    try {
        const history = await ApiService.getMyHistory();
        const historyList = document.getElementById("history-list");
        const countBadge = document.getElementById("history-count");

        if (!historyList) return;
        historyList.innerHTML = "";

        const count = history ? history.length : 0;
        if (countBadge) countBadge.innerText = `${count}개`;

        if (!history || history.length === 0) {
            historyList.innerHTML = `
                <div class="history-empty-notice">
                    <p style="font-size:12px; color:#94A3B8; margin-bottom:4px;">저장된 기획안이 없습니다.</p>
                    <p style="font-size:11px; color:#CBD5E1;">아이디어를 입력해 첫 릴스를 기획해 보세요 ✨</p>
                </div>
            `;
            return;
        }

        history.forEach((item) => {
            const li = document.createElement("li");
            li.className = "history-item";
            li.dataset.chatId = item.id;
            if (currentActiveChatId === item.id) {
                li.classList.add("active");
            }

            const timeStr = timeAgo(item.created_at);

            li.innerHTML = `
                <div class="history-item-left" title="${escapeHtml(item.prompt)}">
                    <span class="history-item-icon">🎬</span>
                    <div class="history-item-text">
                        <span class="history-item-title">${escapeHtml(item.prompt)}</span>
                        <span class="history-item-time">${timeStr}</span>
                    </div>
                </div>
                <button type="button" class="btn-history-delete-item" title="이 기획안 삭제">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            `;

            // 본문 클릭 시 히스토리 불러오기
            const leftArea = li.querySelector(".history-item-left");
            if (leftArea) {
                leftArea.onclick = () => selectChatHistory(item);
            }

            // 개별 삭제 버튼 이벤트 바인딩 (버블링 차단)
            const delBtn = li.querySelector(".btn-history-delete-item");
            if (delBtn) {
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    deleteHistoryItem(item.id, item.prompt);
                };
            }

            historyList.appendChild(li);
        });
    } catch (e) {
        console.error("히스토리 로드 오류:", e);
    }
}

// 히스토리 항목 선택 시 대화 뷰 복원
function selectChatHistory(item) {
    currentActiveChatId = item.id;

    document.querySelectorAll(".history-item").forEach(el => {
        el.classList.toggle("active", el.dataset.chatId === item.id);
    });

    const topbarTitle = document.getElementById("topbar-session-title");
    if (topbarTitle) {
        topbarTitle.innerText = `🎬 ${item.prompt.substring(0, 20)}...`;
    }

    const chatContainer = document.getElementById("chat-messages");
    if (chatContainer) {
        chatContainer.innerHTML = "";
        appendMessage("user", item.prompt);
        appendMessage("ai", item.response);
    }

    setLillyHeaderStatus("idle", "저장된 릴스 기획안 로드 완료 ✨");
    showToast(`'${item.prompt.substring(0, 16)}...' 기획안을 불러왔습니다.`);
}

// 개별 히스토리 삭제
async function deleteHistoryItem(id, promptTitle) {
    try {
        await ApiService.deleteHistory(id);

        // 만약 현재 열려있던 세션이 삭제된 것이라면 새 세션으로 전환
        if (currentActiveChatId === id) {
            startNewChat();
        }

        await loadChatHistory();
        showToast("해당 기획안이 삭제되었습니다. 🗑️");
    } catch (e) {
        showToast("삭제 처리 중 오류가 발생했습니다.");
    }
}

// 전체 히스토리 비우기
async function clearAllHistory() {
    if (confirm("모든 기획 히스토리를 초기화하시겠습니까?")) {
        await ApiService.clearAllHistory();
        startNewChat();
        await loadChatHistory();
        showToast("전체 기획 히스토리가 비워졌습니다. 🧹");
    }
}

// 새 기획 세션 시작 (웰컴 히어로 및 탑바 복원)
function startNewChat() {
    currentActiveChatId = null;
    document.querySelectorAll(".history-item").forEach(el => el.classList.remove("active"));

    const topbarTitle = document.getElementById("topbar-session-title");
    if (topbarTitle) topbarTitle.innerText = "새 릴스 기획";

    setLillyHeaderStatus("idle");

    const chatContainer = document.getElementById("chat-messages");
    if (chatContainer) {
        chatContainer.innerHTML = `
            <div class="welcome-hero-container">
                <div class="hero-mascot-box" title="릴리를 클릭해 보세요! ✨">
                    <div class="hero-avatar-wrap" onclick="triggerMascotClick(event)">
                        <svg class="lilly-hero-svg" viewBox="0 0 120 120" width="96" height="96">
                            <circle class="halo-ring" cx="60" cy="60" r="54" fill="none" stroke="#6366F1" stroke-width="2.5" stroke-dasharray="6 4"/>
                            <circle cx="60" cy="60" r="48" fill="#EEF2FF" stroke="#6366F1" stroke-width="2.5"/>
                            <rect class="slate-bar" x="38" y="14" width="44" height="15" rx="3.5" fill="#4F46E5"/>
                            <line x1="48" y1="14" x2="53" y2="29" stroke="rgba(255,255,255,0.7)" stroke-width="2"/>
                            <line x1="60" y1="14" x2="65" y2="29" stroke="rgba(255,255,255,0.7)" stroke-width="2"/>
                            <line x1="72" y1="14" x2="77" y2="29" stroke="rgba(255,255,255,0.7)" stroke-width="2"/>
                            <circle cx="60" cy="65" r="32" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="1.8"/>
                            <ellipse class="lilly-eye" cx="49" cy="64" rx="4" ry="5.5" fill="#1E1B4B"/>
                            <ellipse class="lilly-eye" cx="71" cy="64" rx="4" ry="5.5" fill="#1E1B4B"/>
                            <circle cx="50" cy="62" r="1.7" fill="#FFFFFF"/>
                            <circle cx="72" cy="62" r="1.7" fill="#FFFFFF"/>
                            <circle cx="43" cy="71" r="5" fill="#F472B6" opacity="0.65"/>
                            <circle cx="77" cy="71" r="5" fill="#F472B6" opacity="0.65"/>
                            <path d="M53 74 Q60 83 67 74" stroke="#1E1B4B" stroke-width="2.8" fill="none" stroke-linecap="round"/>
                            <polygon class="sparkle-star" points="98,28 100,34 106,36 100,38 98,44 96,38 90,36 96,34" fill="#F59E0B"/>
                            <polygon class="sparkle-star-sm" points="22,46 23,50 27,51 23,52 22,56 21,52 17,51 21,50" fill="#F43F5E"/>
                        </svg>
                    </div>
                    <div class="mascot-click-hint" onclick="triggerMascotClick(event)">💡 릴리를 클릭하면 꿀팁을 발화해요! ✨</div>
                </div>

                <h2 class="hero-title">어떤 릴스 대본을 기획해 볼까요?</h2>
                <p class="hero-subtitle">아이디어 한 줄만 주시면 <strong>3초 킬링훅부터 씬별 카메라 연출</strong>까지 실시간으로 기획해 드려요 ✨</p>

                <div class="starter-cards-grid">
                    <div class="starter-card" onclick="applyTemplate(null, '3초 안에 시선 잡는 인스타 릴스 꿀팁 영상 기획해 줘')">
                        <div class="starter-badge-row">
                            <span class="starter-tag">⚡ 바이럴 훅</span>
                            <span class="starter-arrow">→</span>
                        </div>
                        <h4 class="starter-card-title">3초 꿀팁 릴스</h4>
                        <p class="starter-card-desc">시청 이탈을 원천 차단하는 강력한 첫 씬 연출</p>
                    </div>

                    <div class="starter-card" onclick="applyTemplate(null, '다이어트 직장인 현실 공감 30초 릴스 대본 짜 줘')">
                        <div class="starter-badge-row">
                            <span class="starter-tag">🥗 현실 공감</span>
                            <span class="starter-arrow">→</span>
                        </div>
                        <h4 class="starter-card-title">현실 공감 브이로그</h4>
                        <p class="starter-card-desc">직장인 1인칭 시점의 30초 현실 밀착 스토리</p>
                    </div>

                    <div class="starter-card" onclick="applyTemplate(null, '개발자 숏폼: 초보자가 매일 하는 실수 TOP 3 기획')">
                        <div class="starter-badge-row">
                            <span class="starter-tag">💻 정보 전달</span>
                            <span class="starter-arrow">→</span>
                        </div>
                        <h4 class="starter-card-title">초보 실수 TOP 3</h4>
                        <p class="starter-card-desc">저장과 공유를 부르는 3단계 꿀팁 정보형 숏폼</p>
                    </div>

                    <div class="starter-card" onclick="applyTemplate(null, '인스타 알고리즘 떡상하는 치트키 3가지 릴스')">
                        <div class="starter-badge-row">
                            <span class="starter-tag">📈 알고리즘</span>
                            <span class="starter-arrow">→</span>
                        </div>
                        <h4 class="starter-card-title">떡상 치트키 릴스</h4>
                        <p class="starter-card-desc">조회수와 팔로워를 급상승시키는 공식 대본</p>
                    </div>
                </div>
            </div>
        `;
    }

    const textarea = document.getElementById("user-input");
    if (textarea) {
        textarea.value = "";
        document.getElementById("char-count").innerText = "0";
        autoResize(textarea);
        textarea.focus();
    }
    showToast("새 기획 세션이 시작되었습니다. ✨");
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   5. 메시지 전송 및 실시간 더미 스트리밍 파이프라인
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
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

    const topbarTitle = document.getElementById("topbar-session-title");
    if (topbarTitle) {
        topbarTitle.innerText = `🎬 ${prompt.substring(0, 20)}...`;
    }

    const duration = document.getElementById("select-duration") ? document.getElementById("select-duration").value : "30s";
    const tone = document.getElementById("select-tone") ? document.getElementById("select-tone").value : "viral";

    appendMessage("user", prompt);
    textarea.value = "";
    document.getElementById("char-count").innerText = "0";
    autoResize(textarea);

    isGenerating = true;
    lastFailedPrompt = prompt;
    setLillyHeaderStatus("generating");
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
                    setLillyHeaderStatus("streaming");
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
                setLillyHeaderStatus("complete");
                finishGeneration();
                loadChatHistory();
                createConfettiEffect(window.innerWidth / 2, 80);
                showToast("대본 기획이 성공적으로 완성되었습니다! 🎉");

                // 2.5초 후 대기 상태로 복귀
                setTimeout(() => {
                    if (!isGenerating) setLillyHeaderStatus("idle");
                }, 2500);
            },
            // 3) 에러 시 (과제 제약: 비정상 종료 방지 및 사용자 안내)
            (err) => {
                removeMessage(loadingId);
                setLillyHeaderStatus("idle");
                appendErrorMessage(err.message || "응답 생성 중 오류가 발생했습니다. (error: AI_TIMEOUT)");
                finishGeneration();
            }
        );
    } catch (e) {
        removeMessage(loadingId);
        setLillyHeaderStatus("idle");
        appendErrorMessage(e.message || "요청 처리 중 오류가 발생했습니다. (error: AI_TIMEOUT)");
        finishGeneration();
    }
}

function updateSendButtonState(generating) {
    const btn = document.getElementById("btn-send");
    const btnText = document.getElementById("btn-send-text");
    const btnIcon = document.getElementById("btn-send-icon");
    const inputWrapper = document.querySelector(".chat-input-wrapper");
    const textarea = document.getElementById("user-input");
    const presetChips = document.querySelector(".preset-chips-slider");

    if (!btn) return;

    if (generating) {
        btn.classList.add("btn-stop");
        if (btnText) btnText.innerText = "기획 중단";
        if (btnIcon) btnIcon.innerHTML = `<rect x="6" y="6" width="12" height="12" fill="currentColor"/>`;

        // 입력창 잠금 (스트리밍 중 신규 입력 방지)
        if (inputWrapper) inputWrapper.classList.add("locked");
        if (textarea) textarea.setAttribute("disabled", "disabled");
        if (presetChips) presetChips.style.opacity = "0.5";
        if (presetChips) presetChips.style.pointerEvents = "none";
    } else {
        btn.classList.remove("btn-stop");
        if (btnText) btnText.innerText = "대본 기획 시작";
        if (btnIcon) btnIcon.innerHTML = `<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>`;

        // 입력창 잠금 해제
        if (inputWrapper) inputWrapper.classList.remove("locked");
        if (textarea) textarea.removeAttribute("disabled");
        if (presetChips) presetChips.style.opacity = "";
        if (presetChips) presetChips.style.pointerEvents = "";

        // 포커스 복귀 및 사이즈 리셋
        if (textarea && document.activeElement !== textarea) {
            setTimeout(() => textarea.focus(), 100);
        }
    }
}

function finishGeneration() {
    isGenerating = false;
    activeStreamController = null;
    setMascotThinking(false);
    updateSendButtonState(false);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   6. 화면 렌더링 헬퍼 함수
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function appendMessage(sender, text) {
    const chatContainer = document.getElementById("chat-messages");
    if (!chatContainer) return;

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
    if (!chatContainer) return;

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
        if (textarea) textarea.value = lastFailedPrompt;
        sendMessage();
    }
}

function appendLoadingBubble() {
    const id = "loading-" + Date.now();
    const chatContainer = document.getElementById("chat-messages");
    if (!chatContainer) return id;

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

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   7. 마스코트 인터랙션 (점프 스핀 + 대사 말풍선 + 폭죽 파티클)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let speechBubbleTimer = null;

function triggerMascotClick(event) {
    // 모든 릴리 마스코트 점프 스핀
    const mascots = document.querySelectorAll(".lilly-mascot-svg, .lilly-hero-svg, #main-mascot");
    mascots.forEach(m => {
        m.classList.remove("jump-spin");
        void m.offsetWidth;
        m.classList.add("jump-spin");
    });

    // 클릭 위치 폭죽 파티클
    const clickX = (event && event.clientX) ? event.clientX : (window.innerWidth / 2);
    const clickY = (event && event.clientY) ? event.clientY : 180;
    createConfettiEffect(clickX, clickY);

    // 릴리의 풍부한 숏폼/릴스 바이럴 꿀팁 대사 세트
    const quotes = [
        "3초 안에 시선을 뺏는 첫 씬이 바이럴의 90%예요! 🎬",
        "호기심을 자극하는 질문형 훅으로 시작하면 이탈률이 확 줄어요! ✨",
        "시청자가 끝까지 보게 만드는 반전 복선을 심어드릴게요! 🚀",
        "저장하고 나중에 다시 보게 만드는 체크리스트를 꼭 넣으세요! 💾",
        "댓글을 부르는 찬반 질문 CTA를 마지막 컷에 배치해 보세요! 💬",
        "지금 인스타 트렌드 탭에서 급상승 중인 릴스 음원을 입혀보세요! 🎵",
        "궁금한 아이디어를 아래 입력창에 편하게 한 줄만 적어주세요! 💡",
        "대본이 완성되면 복사 버튼으로 캡컷에 바로 붙여넣을 수 있어요! 📋",
        "썸네일 텍스트는 7글자 이내로 큼직하게 넣는 게 국룰이에요! 🔍",
        "초반 1초에 손가락 제스처나 얼굴 표정을 크게 쓰면 시선이 고정돼요! 👀"
    ];
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];

    // 릴리 캐릭터 우측 말풍선에 대사 표시 (헤더 가림 방지)
    showMascotSpeechBubble(randomQuote);

    // 탑바 상태 위젯 피드백
    const topbarPill = document.getElementById("topbar-lilly-live-status");
    if (topbarPill) {
        topbarPill.classList.add("typing");
        setTimeout(() => {
            if (!isGenerating) topbarPill.classList.remove("typing");
        }, 1800);
    }

    const badges = document.querySelectorAll(".mascot-badge-dot, #mascot-emotion-badge");
    badges.forEach(b => {
        b.innerText = "💖";
        setTimeout(() => { b.innerText = "🎬"; }, 1600);
    });
}

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

        if (speechBubbleTimer) clearTimeout(speechBubbleTimer);
        speechBubbleTimer = setTimeout(() => {
            bubble.classList.remove("show");
        }, 3600);
    }
}

function setMascotThinking(isThinking) {
    const mascot = document.getElementById("main-mascot");
    if (!mascot) return;

    if (isThinking) {
        mascot.classList.add("thinking-pulse");
    } else {
        mascot.classList.remove("thinking-pulse");
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   8. 사이드바 토글 및 부가 도구 (다듬기, 복사, 다운로드)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function toggleSidebar() {
    const sidebar = document.getElementById("sidebar") || document.getElementById("app-sidebar");
    const openBtn = document.getElementById("btn-sidebar-open");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (!sidebar) return;

    // 화면 너비에 따라 .collapsed (데스크톱) 또는 .open (모바일) 클래스 구분 사용
    if (window.innerWidth <= 900) {
        sidebar.classList.toggle("open");
        const isOpen = sidebar.classList.contains("open");
        if (openBtn) openBtn.style.display = isOpen ? "none" : "flex";
        if (backdrop) backdrop.classList.toggle("active", isOpen);
        document.body.classList.toggle("sidebar-open", isOpen);
    } else {
        sidebar.classList.toggle("collapsed");
        const isCollapsed = sidebar.classList.contains("collapsed");
        if (openBtn) openBtn.style.display = isCollapsed ? "flex" : "none";
    }
}

function closeSidebarMobile() {
    const sidebar = document.getElementById("sidebar") || document.getElementById("app-sidebar");
    const openBtn = document.getElementById("btn-sidebar-open");
    const backdrop = document.getElementById("sidebar-backdrop");

    if (sidebar) sidebar.classList.remove("open");
    if (backdrop) backdrop.classList.remove("active");
    document.body.classList.remove("sidebar-open");
    if (openBtn && window.innerWidth <= 900) openBtn.style.display = "flex";
}

function enhancePromptWithMagic() {
    const textarea = document.getElementById("user-input");
    if (!textarea) return;

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

    handleInputLive(textarea);
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
    handleInputLive(textarea);
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
}

function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   9. DB 로그 및 세션 모달 (과제 4번 요구사항 실현)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function openDbModal() {
    const modal = document.getElementById("db-modal");
    if (!modal) return;
    modal.style.display = "flex";
    document.body.classList.add("modal-open");
    renderDbLogs();
}

function closeDbModal() {
    const modal = document.getElementById("db-modal");
    if (modal) {
        modal.style.display = "none";
        document.body.classList.remove("modal-open");
    }
}

function switchDbTab(tab) {
    currentDbTab = tab;
    const isLogs = tab === "logs";
    const tabLogs = document.getElementById("db-tab-logs");
    const tabSessions = document.getElementById("db-tab-sessions");
    if (tabLogs) tabLogs.classList.toggle("active", isLogs);
    if (tabSessions) tabSessions.classList.toggle("active", !isLogs);
    renderDbLogs();
}

async function renderDbLogs() {
    const tbody = document.getElementById("db-table-body");
    const thead = document.getElementById("db-table-head");
    if (!tbody) return;

    try {
        const logs = await ApiService.getMyHistory();
        tbody.innerHTML = "";

        if (currentDbTab === "sessions") {
            if (thead) {
                thead.innerHTML = `
                    <tr>
                        <th style="width: 25%;">세션 ID</th>
                        <th style="width: 30%;">크리에이터 계정</th>
                        <th style="width: 25%;">문맥 유지 상태</th>
                        <th style="width: 20%;">최근 요청 시각</th>
                    </tr>
                `;
            }
            const token = localStorage.getItem("access_token");
            const username = localStorage.getItem("username") || "게스트";
            const sessionActive = Boolean(token);

            tbody.innerHTML = `
                <tr>
                    <td style="font-size:12px; font-weight:700; color:#4F46E5;">SESSION-LIVE-01</td>
                    <td style="font-weight:700; color:#0F172A;">${escapeHtml(username)}</td>
                    <td><span style="font-size:11px; background:#EEF2FF; color:#4F46E5; padding:3px 8px; border-radius:9999px; font-weight:700;">${sessionActive ? "3-turn Memory Active" : "비로그인 세션"}</span></td>
                    <td style="font-size:12px; color:#64748B;">방금 전</td>
                </tr>
            `;
            return;
        }

        // 대화 메시지 로그 탭
        if (thead) {
            thead.innerHTML = `
                <tr>
                    <th style="width: 15%;">로그 ID</th>
                    <th style="width: 48%;">기획 프롬프트 요약</th>
                    <th style="width: 22%;">상태 코드</th>
                    <th style="width: 15%;">기록 시각</th>
                </tr>
            `;
        }

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
        ApiService.clearAllHistory();
        renderDbLogs();
        loadChatHistory();
        showToast("🧹 DB 대화 로그가 초기화되었습니다.");
    }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   10. 유틸리티 (토스트, 상대 시간, 특수문자 이스케이프, 파티클)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let toastTimer = null;
let lastToastTime = 0;
let lastToastMessage = "";

function showToast(message) {
    if (!message) return;

    const now = Date.now();
    // 동일 메시지 또는 1.8초 이내 빠른 연속 호출 시 도배 방지 (텀 적용)
    if (message === lastToastMessage && now - lastToastTime < 2400) {
        return;
    }

    lastToastTime = now;
    lastToastMessage = message;

    const toast = document.getElementById("toast");
    if (!toast) return;

    toast.innerText = message;
    toast.classList.remove("show");
    void toast.offsetWidth; // 리플로우 유도
    toast.classList.add("show");

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2800);
}

function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.innerText = text;
    return div.innerHTML;
}

function timeAgo(dateString) {
    if (!dateString) return "방금 전";
    const now = new Date();
    const past = new Date(dateString);
    const diffMs = now - past;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return "방금 전";
    if (diffMin < 60) return `${diffMin}분 전`;
    if (diffHour < 24) return `${diffHour}시간 전`;
    if (diffDay < 7) return `${diffDay}일 전`;
    return past.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function createConfettiEffect(x, y) {
    const container = document.getElementById("particle-container");
    if (!container) return;

    const colors = ["#4F46E5", "#6366F1", "#F43F5E", "#F59E0B", "#10B981", "#EC4899"];
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
        const velocity = Math.random() * 140 + 60;
        const vx = Math.cos(angle) * velocity;
        const vy = Math.sin(angle) * velocity;

        let startTime = performance.now();
        function animate(now) {
            const elapsed = (now - startTime) / 1000;
            if (elapsed > 0.8) {
                particle.remove();
                return;
            }
            particle.style.transform = `translate(${vx * elapsed}px, ${vy * elapsed + 180 * elapsed * elapsed}px) rotate(${elapsed * 720}deg)`;
            particle.style.opacity = `${1 - elapsed / 0.8}`;
            requestAnimationFrame(animate);
        }
        requestAnimationFrame(animate);
    }
}