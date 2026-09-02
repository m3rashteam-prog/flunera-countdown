/**
 * ============================================================
 * FUNERA AI — UNIVERSAL FRONTEND AUTH HELPER
 * ============================================================
 * Single point of authentication for all Funera AI pages.
 * Supports:
 * - Google Identity Services (GIS) Web flow
 * - Session status (/api/me)
 * - Free / Pro / Premium plan checks
 * - Automatic navbar & profile UI updates
 * - Logout & auth guards
 * ============================================================
 */

(function (window) {
    "use strict";

    let cachedUser = null;
    let publicConfig = null;

    const DEFAULT_CLIENT_ID =
        "445356092750-7fhjqpcivhg4rmopkps77hqdfuurkfce.apps.googleusercontent.com";

    const FuneraAuth = {
        /**
         * Fetch public configuration from backend (/api/public-config)
         */
        async getConfig() {
            if (publicConfig) return publicConfig;
            try {
                const res = await fetch("/api/public-config", { cache: "no-store" });
                if (res.ok) {
                    publicConfig = await res.json();
                }
            } catch (e) {
                console.warn("[FuneraAuth] Could not fetch public-config, using fallback:", e);
            }
            if (!publicConfig) {
                publicConfig = {
                    ok: true,
                    googleClientId: DEFAULT_CLIENT_ID,
                    baseUrl: window.location.origin,
                    preregistrationOpen: true
                };
            }
            return publicConfig;
        },

        /**
         * Get current authenticated user session (/api/me)
         */
        async getMe(forceRefresh = false) {
            if (cachedUser && !forceRefresh) return cachedUser;
            try {
                const res = await fetch("/api/me", {
                    method: "GET",
                    credentials: "include",
                    cache: "no-store"
                });

                if (!res.ok) {
                    cachedUser = null;
                    return null;
                }

                const data = await res.json();
                if ((data.ok || data.success) && data.authenticated && data.user) {
                    cachedUser = data.user;
                    this.saveLocalUser(cachedUser);
                    return cachedUser;
                }
                cachedUser = null;
                return null;
            } catch (err) {
                console.warn("[FuneraAuth] getMe error:", err);
                cachedUser = null;
                return null;
            }
        },

        /**
         * Save user info in localStorage for fast synchronous render
         */
        saveLocalUser(user) {
            if (!user) return;
            if (user.name) {
                localStorage.setItem("userName", user.name);
                localStorage.setItem("name", user.name);
            }
            if (user.email) {
                localStorage.setItem("userEmail", user.email);
                localStorage.setItem("email", user.email);
            }
            if (user.picture || user.avatar) {
                const pic = user.picture || user.avatar;
                localStorage.setItem("userAvatar", pic);
                localStorage.setItem("picture", pic);
                localStorage.setItem("avatar", pic);
            }
            if (user.plan) localStorage.setItem("userPlan", user.plan);
            if (user.stars !== undefined) localStorage.setItem("userStars", String(user.stars));
            localStorage.setItem("googleLoggedIn", "true");
        },

        /**
         * Clear localStorage auth keys
         */
        clearLocalUser() {
            localStorage.removeItem("userName");
            localStorage.removeItem("name");
            localStorage.removeItem("userEmail");
            localStorage.removeItem("email");
            localStorage.removeItem("userAvatar");
            localStorage.removeItem("picture");
            localStorage.removeItem("avatar");
            localStorage.removeItem("userPlan");
            localStorage.removeItem("userStars");
            localStorage.removeItem("googleLoggedIn");
        },

        /**
         * Send Google credential to backend (/api/auth/google)
         */
        async loginWithGoogle(credential, options = {}) {
            if (!credential) {
                throw new Error("No credential provided");
            }

            const res = await fetch("/api/auth/google", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ credential })
            });

            let data;
            try {
                data = await res.json();
            } catch {
                throw new Error("Server returned an invalid response.");
            }

            if (!res.ok || (!data.ok && !data.success)) {
                throw new Error(data?.error || "Google authentication failed.");
            }

            if (data.user) {
                cachedUser = data.user;
                this.saveLocalUser(data.user);
            }

            if (options.redirect !== false) {
                const target = options.redirectUrl || "/profile.html";
                setTimeout(() => {
                    window.location.href = target;
                }, options.redirectDelay || 400);
            }

            return data;
        },

        /**
         * Logout user (/api/auth/logout) and clear session
         */
        async logout(redirectUrl = "login.html") {
            try {
                await fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "include"
                });
            } catch (e) {
                console.warn("[FuneraAuth] Logout request failed:", e);
            }

            cachedUser = null;
            this.clearLocalUser();

            if (redirectUrl) {
                window.location.href = redirectUrl;
            }
        },

        /**
         * Require authentication on a protected page.
         * If user is not logged in -> redirect to login.
         * If minPlan is required (e.g. 'Pro' or 'Premium') and user is Free:
         * DOES NOT kick to login; instead shows upgrade message or calls onPlanDenied.
         */
        async requireAuth(options = {}) {
            const redirectTo = options.redirectTo || "login.html";
            const minPlan = options.minPlan || "Free"; // 'Free' | 'Pro' | 'Premium'

            const user = await this.getMe(true);

            if (!user) {
                const currentUrl = encodeURIComponent(window.location.pathname + window.location.search);
                window.location.href = `${redirectTo}?redirect=${currentUrl}`;
                return null;
            }

            // Check plan hierarchy: Free < Pro < Premium
            const planWeights = { free: 0, pro: 1, premium: 2 };
            const userWeight = planWeights[String(user.plan || "Free").toLowerCase()] ?? 0;
            const requiredWeight = planWeights[String(minPlan).toLowerCase()] ?? 0;

            if (userWeight < requiredWeight) {
                if (typeof options.onPlanDenied === "function") {
                    options.onPlanDenied(user, minPlan);
                } else if (options.upgradeRedirect) {
                    window.location.href = `premium.html?plan=${encodeURIComponent(minPlan)}`;
                } else {
                    this.showUpgradeModal(minPlan, user);
                }
                return user;
            }

            this.updateAuthUI(user);
            return user;
        },

        /**
         * Universal Upgrade Modal for Free users accessing Pro/Premium features
         */
        showUpgradeModal(requiredPlan = "Pro", user = null) {
            let modal = document.getElementById("funera-upgrade-modal");
            if (!modal) {
                modal = document.createElement("div");
                modal.id = "funera-upgrade-modal";
                modal.style.cssText = `
                    position: fixed; inset: 0; z-index: 99999;
                    background: rgba(4, 5, 15, 0.85);
                    backdrop-filter: blur(12px);
                    display: flex; align-items: center; justify-content: center;
                    padding: 20px; font-family: Inter, -apple-system, sans-serif;
                `;
                modal.innerHTML = `
                    <div style="
                        background: linear-gradient(145deg, #13152c, #0a0b18);
                        border: 1px solid rgba(108, 92, 231, 0.35);
                        border-radius: 20px; max-width: 440px; width: 100%;
                        padding: 32px 28px; text-align: center; color: white;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.6);
                    ">
                        <div style="font-size: 40px; margin-bottom: 12px;">⚡</div>
                        <h2 style="font-size: 22px; font-weight: 800; margin-bottom: 10px;">
                            <span style="background: linear-gradient(90deg, #6c5ce7, #00cec9); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">${requiredPlan}</span> Feature
                        </h2>
                        <p style="color: #9aa0c2; font-size: 14px; line-height: 1.6; margin-bottom: 24px;">
                            This feature is available for <strong>${requiredPlan}</strong> members. Upgrade your Funera AI account to unlock unlimited access.
                        </p>
                        <div style="display: flex; gap: 12px; justify-content: center;">
                            <a href="premium.html?plan=${encodeURIComponent(requiredPlan)}" style="
                                padding: 12px 24px; border-radius: 12px;
                                background: linear-gradient(135deg, #6c5ce7, #00cec9);
                                color: white; font-weight: 700; text-decoration: none;
                                font-size: 14px; display: inline-block;
                            ">Upgrade Now →</a>
                            <button onclick="document.getElementById('funera-upgrade-modal').remove()" style="
                                padding: 12px 20px; border-radius: 12px;
                                background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
                                color: #a4b0be; font-weight: 600; cursor: pointer; font-size: 14px;
                            ">Cancel</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }
        },

        /**
         * Initialize Google Identity Services button inside a container
         * @param {string|HTMLElement} container - DOM element or ID
         * @param {Object} options - GIS options (theme, size, width, text, onLogin, onError)
         */
        async initGoogleButton(container, options = {}) {
            const containerEl = typeof container === "string" ? document.getElementById(container) : container;
            if (!containerEl) {
                console.warn("[FuneraAuth] Container not found for Google button:", container);
                return;
            }

            // Check file:// protocol
            if (window.location.protocol === "file:") {
                containerEl.innerHTML = `
                    <div style="color: #ff8e9b; font-size: 13px; text-align: center; padding: 10px;">
                        ⚠️ Open Funera AI through the server:<br>
                        <a href="http://localhost:5000" style="color: #63e2d4; font-weight: bold; text-decoration: underline;">http://localhost:5000</a>
                    </div>
                `;
                return;
            }

            // Show initial loading state
            containerEl.innerHTML = `
                <div class="funera-google-loader" style="display:inline-flex; align-items:center; gap:8px; color:rgba(255,255,255,0.6); font-size:13px; padding:10px;">
                    <span style="display:inline-block; width:16px; height:16px; border:2px solid rgba(255,255,255,0.2); border-top-color:#6c5ce7; border-radius:50%; animation:funera-spin 0.75s linear infinite;"></span>
                    <span>Loading Google Sign-In...</span>
                </div>
            `;

            // Inject spin keyframe if not present
            if (!document.getElementById("funera-auth-style")) {
                const style = document.createElement("style");
                style.id = "funera-auth-style";
                style.textContent = `
                    @keyframes funera-spin { to { transform: rotate(360deg); } }
                `;
                document.head.appendChild(style);
            }

            const config = await this.getConfig();
            const clientId = config?.googleClientId || DEFAULT_CLIENT_ID;

            // Load Google SDK if not yet loaded
            const ensureGoogleSdk = () => {
                return new Promise((resolve, reject) => {
                    if (window.google?.accounts?.id) {
                        return resolve(window.google);
                    }

                    let script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
                    if (!script) {
                        script = document.createElement("script");
                        script.src = "https://accounts.google.com/gsi/client";
                        script.async = true;
                        script.defer = true;
                        document.head.appendChild(script);
                    }

                    let elapsed = 0;
                    const interval = setInterval(() => {
                        elapsed += 100;
                        if (window.google?.accounts?.id) {
                            clearInterval(interval);
                            return resolve(window.google);
                        }
                        if (elapsed >= 5000) {
                            clearInterval(interval);
                            reject(new Error("Google Identity Services timed out"));
                        }
                    }, 100);
                });
            };

            try {
                await ensureGoogleSdk();

                const handleCredentialResponse = async (response) => {
                    try {
                        containerEl.innerHTML = `
                            <div style="color: #63e2d4; font-size: 13px; font-weight: 600; padding: 10px;">
                                Signing in...
                            </div>
                        `;
                        const res = await this.loginWithGoogle(response.credential, {
                            redirect: options.redirect !== false,
                            redirectUrl: options.redirectUrl || "/profile.html"
                        });
                        if (typeof options.onLogin === "function") {
                            options.onLogin(res);
                        }
                    } catch (err) {
                        console.error("[FuneraAuth] Login failed:", err);
                        containerEl.innerHTML = `
                            <div style="color: #ff8e9b; font-size: 13px; margin-bottom: 6px;">
                                ${err?.message || "Sign-in failed"}
                            </div>
                            <button class="funera-retry-btn" style="padding:6px 14px; border-radius:8px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; font-size:12px; cursor:pointer;">
                                Try again
                            </button>
                        `;
                        containerEl.querySelector(".funera-retry-btn")?.addEventListener("click", () => {
                            this.initGoogleButton(container, options);
                        });
                        if (typeof options.onError === "function") {
                            options.onError(err);
                        }
                    }
                };

                window.google.accounts.id.initialize({
                    client_id: clientId,
                    client_id: clientId,
                    callback: handleCredentialResponse,
                    auto_select: false,
                    cancel_on_tap_outside: true,
                    context: "signin"
                });

                containerEl.innerHTML = "";
                window.google.accounts.id.renderButton(containerEl, {
                    type: options.type || "standard",
                    theme: options.theme || "outline",
                    size: options.size || "large",
                    text: options.text || "continue_with",
                    shape: options.shape || "rectangular",
                    logo_alignment: options.logo_alignment || "left",
                    width: options.width || 320
                });

                try {
                    window.google.accounts.id.prompt();
                } catch (_) {}

            } catch (error) {
                console.warn("[FuneraAuth] Google SDK load error:", error);
                containerEl.innerHTML = `
                    <div style="color: #ff8e9b; font-size: 13px; margin-bottom: 8px;">
                        Google Sign-In unavailable
                    </div>
                    <button class="funera-retry-btn" style="padding:6px 14px; border-radius:8px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; font-size:12px; cursor:pointer;">
                        Try again
                    </button>
                `;
                containerEl.querySelector(".funera-retry-btn")?.addEventListener("click", () => {
                    this.initGoogleButton(container, options);
                });
            }
        },

        /**
         * Update common UI indicators across any page
         */
        updateAuthUI(user) {
            if (!user) {
                document.querySelectorAll(".auth-only").forEach(el => el.style.display = "none");
                document.querySelectorAll(".guest-only").forEach(el => el.style.display = "");
                return;
            }

            document.querySelectorAll(".guest-only").forEach(el => el.style.display = "none");
            document.querySelectorAll(".auth-only").forEach(el => el.style.display = "");

            // Name
            document.querySelectorAll("#navUserName, .user-name, #userName").forEach(el => {
                el.textContent = user.name || "Funera AI User";
            });

            // Email
            document.querySelectorAll("#navUserEmail, .user-email, #userEmail").forEach(el => {
                el.textContent = user.email || "";
            });

            // Stars
            document.querySelectorAll("#navStars, .user-stars, #stars, .stars-badge, #starsBadge").forEach(el => {
                const count = Number(user.stars ?? 0).toLocaleString();
                if (el.tagName === "INPUT") el.value = count;
                else el.textContent = `⭐ ${count}`;
            });

            // Plan Badge
            const plan = (user.plan || "Free").toUpperCase();
            document.querySelectorAll("#navPlan, .user-plan, #userPlan, .plan-badge, #planBadge").forEach(el => {
                el.textContent = plan;
                el.className = el.className.replace(/\bplan-(free|pro|premium)\b/g, "").trim();
                el.classList.add(`plan-${plan.toLowerCase()}`);
            });

            // Avatar
            const avatarUrl = user.picture || user.avatar;
            if (avatarUrl) {
                document.querySelectorAll("#navAvatar, .user-avatar, #userAvatar, #avatarContainer").forEach(el => {
                    if (el.tagName === "IMG") {
                        el.src = avatarUrl;
                    } else if (el.id === "avatarContainer" || el.classList.contains("avatar-box")) {
                        const img = document.createElement("img");
                        img.className = el.className;
                        img.id = el.id;
                        img.src = avatarUrl;
                        img.alt = user.name || "Avatar";
                        el.replaceWith(img);
                    }
                });
            }
        },

        /**
         * Auto-initialize UI on page load if user is logged in
         */
        async autoInit() {
            const user = await this.getMe();
            this.updateAuthUI(user);
            return user;
        }
    };

    window.FuneraAuth = FuneraAuth;

    // Auto-run on DOM ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => FuneraAuth.autoInit());
    } else {
        FuneraAuth.autoInit();
    }

})(window);
