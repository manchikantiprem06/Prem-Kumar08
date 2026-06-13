document.addEventListener('DOMContentLoaded', () => {

    // --- State Management ---
    let currentUser = null;
    let searchHistory = [];
    let activeReminders = [];
    let notificationCheckInterval = null;

    // --- Map Variables ---
    let map = null;
    let userLocation = { lat: 20.5937, lng: 78.9629 }; // Default: centre of India

    // --- DOM Elements ---
    const views = document.querySelectorAll('.view');
    const navbar = document.getElementById('navbar');
    const logoutBtn = document.getElementById('logout-btn');
    const backBtn = document.getElementById('back-btn');
    const navCards = document.querySelectorAll('.nav-card');
    const bigHomeBtn = document.getElementById('big-home-btn');

    // Auth Forms
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const showRegisterMsg = document.getElementById('show-register');
    const showLoginMsg = document.getElementById('show-login');

    // Explore Symptoms
    const symptomsForm = document.getElementById('symptoms-form');
    const symptomsInput = document.getElementById('symptoms-input');
    const recommendationResult = document.getElementById('recommendation-result');

    // Nearest Stores
    const storesList = document.getElementById('stores-list');

    // Chatbot
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');

    // History
    const historyList = document.getElementById('history-list');

    // --- View Navigation System ---
    function switchView(targetViewId) {
        // Hide all views
        views.forEach(view => {
            view.classList.add('hidden');
            view.classList.remove('active');
        });

        // Show target view
        const targetView = document.getElementById(targetViewId);
        if (targetView) {
            targetView.classList.remove('hidden');
            targetView.classList.add('active');
        }

        // Configure Navbar
        if (targetViewId === 'auth-view') {
            navbar.classList.add('hidden');
        } else {
            navbar.classList.remove('hidden');

            if (targetViewId === 'dashboard-view') {
                backBtn.classList.add('hidden');
                logoutBtn.classList.remove('hidden');
            } else {
                backBtn.classList.remove('hidden');
                logoutBtn.classList.add('hidden');
            }
        }

        // Trigger view-specific logic
        if (targetViewId === 'stores-view') initMap();
        if (targetViewId === 'history-view') populateHistory();
        if (targetViewId === 'schedule-view') fetchReminders();
    }

    backBtn.addEventListener('click', () => switchView('dashboard-view'));
    logoutBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/logout', { method: 'POST' });
        } catch (e) {
            console.error('Logout error:', e);
        }
        currentUser = null;
        if (notificationCheckInterval) clearInterval(notificationCheckInterval);
        switchView('auth-view');
        // Reset forms
        loginForm.reset();
        registerForm.reset();
        chatMessages.innerHTML = `<div class="message bot"><div class="msg-bubble">Hi there! I am your AI Health Assistant. How can I help you today?</div></div>`;
        recommendationResult.classList.add('hidden');
    });

    bigHomeBtn.addEventListener('click', () => switchView('dashboard-view'));

    navCards.forEach(card => {
        card.addEventListener('click', () => {
            const target = card.getAttribute('data-target');
            switchView(target);
        });
    });

    // --- Authentication Logic (Mock) ---
    showRegisterMsg.addEventListener('click', () => {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
    });

    showLoginMsg.addEventListener('click', () => {
        registerForm.classList.add('hidden');
        loginForm.classList.remove('hidden');
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const mobile = document.getElementById('login-mobile').value;
        const password = document.getElementById('login-password').value;

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mobile, password })
            });
            const data = await response.json();

            if (response.ok) {
                currentUser = { mobile: mobile };
                switchView('dashboard-view');
                fetchReminders();
                fetchNotifications();
                startReminderCheck();
            } else {
                alert(data.error || 'Login failed');
            }
        } catch (error) {
            console.error('Error logging in:', error);
            alert('An error occurred during login. Please try again.');
        }
    });

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const mobile = document.getElementById('reg-mobile').value;
        const password = document.getElementById('reg-password').value;
        const conf = document.getElementById('reg-confirm').value;

        if (password !== conf) {
            alert("Passwords do not match!");
            return;
        }

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mobile, password })
            });
            const data = await response.json();

            if (response.ok) {
                alert("Registration Successful! Please login.");
                registerForm.classList.add('hidden');
                loginForm.classList.remove('hidden');
            } else {
                alert(data.error || 'Registration failed');
            }
        } catch (error) {
            console.error('Error registering:', error);
            alert('An error occurred during registration. Please try again.');
        }
    });


    // --- Explore Symptoms Logic (Flask API) ---
    symptomsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const symptoms = symptomsInput.value;

        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ symptoms })
            });

            const result = await response.json();

            if (response.ok) {
                document.getElementById('res-illness').textContent = result.illness;
                document.getElementById('res-medicine').textContent = result.medicine;
                document.getElementById('res-usage').textContent = result.how;
                document.getElementById('res-timing').textContent = result.when;
                document.getElementById('res-precautions').textContent = result.precautions;
                recommendationResult.classList.remove('hidden');

                // Save to Firestore
                try {
                    await fb.addDoc(fb.collection(fb.db, 'searchHistory'), {
                        userId: currentUser.mobile,
                        symptom: symptoms,
                        medicine: result.medicine,
                        timestamp: fb.serverTimestamp()
                    });
                } catch (e) {
                    console.error("Error saving search history", e);
                }
            } else {
                if (response.status === 401) {
                    alert('Please login to use this feature.');
                    switchView('auth-view');
                } else {
                    alert(result.error || 'Failed to analyze symptoms.');
                }
            }
        } catch (error) {
            console.error('Error analyzing symptoms:', error);
            alert('Could not reach the server. Please make sure the backend is running.');
        }
    });

    // --- Real Nearby Medical Stores (Leaflet + Overpass API) ---
    function initMap() {
        if (!window.L) return;

        // Destroy previous map instance to allow re-render
        if (map) {
            map.remove();
            map = null;
        }

        storesList.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fa-solid fa-location-crosshairs fa-beat" style="color:var(--lime-green);"></i> Detecting your location...</div>';

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    userLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                    };
                    renderLeafletMap();
                },
                (error) => {
                    console.warn('Geolocation denied:', error.message);
                    storesList.innerHTML = '<div style="text-align:center;padding:20px;color:#ff8f8f;"><i class="fa-solid fa-location-slash" style="font-size:2rem;"></i><p style="margin-top:10px;">Location access denied. Showing default region. Please enable GPS for accurate results.</p></div>';
                    renderLeafletMap(); // still render with default
                }
            );
        } else {
            renderLeafletMap();
        }
    }

    function renderLeafletMap() {
        map = L.map('map').setView([userLocation.lat, userLocation.lng], 14);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        // Blue dot for user position
        const userIcon = L.divIcon({
            html: '<div style="background:#6366f1;width:14px;height:14px;border-radius:50%;border:3px solid white;box-shadow:0 0 8px rgba(99,102,241,0.8);"></div>',
            className: '',
            iconSize: [14, 14]
        });
        L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
            .addTo(map)
            .bindPopup('<strong>Your Location</strong>')
            .openPopup();

        searchNearbyPharmacies();
    }

    async function searchNearbyPharmacies() {
        storesList.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fa-solid fa-spinner fa-spin" style="color:var(--lime-green);"></i> Searching for nearby medical stores...</div>';

        const overpassUrl = 'https://overpass-api.de/api/interpreter';
        const query = `
            [out:json][timeout:25];
            (
              node["amenity"~"pharmacy|hospital|clinic|doctors"](around:5000, ${userLocation.lat}, ${userLocation.lng});
              way["amenity"~"pharmacy|hospital|clinic|doctors"](around:5000, ${userLocation.lat}, ${userLocation.lng});
              node["shop"~"medical_supply|chemist|drugstore"](around:5000, ${userLocation.lat}, ${userLocation.lng});
              node["healthcare"~"pharmacy|hospital|clinic|centre"](around:5000, ${userLocation.lat}, ${userLocation.lng});
            );
            out center;
        `;

        try {
            const response = await fetch(overpassUrl, { method: 'POST', body: query });
            const data = await response.json();

            if (data.elements && data.elements.length > 0) {
                storesList.innerHTML = '';
                const results = data.elements.slice(0, 50);
                const bounds = [];

                results.forEach(place => {
                    const lat = place.lat || (place.center ? place.center.lat : null);
                    const lon = place.lon || (place.center ? place.center.lon : null);
                    if (!lat || !lon) return;

                    const name = place.tags.name || 'Medical Store';
                    const address = place.tags['addr:street'] || place.tags['addr:full'] || 'Near your location';
                    const amenity = (place.tags.amenity || place.tags.healthcare || place.tags.shop || '').replace('_', ' ');

                    // Map marker
                    const pharmIcon = L.divIcon({
                        html: `<div style="background:#d9fa50;color:#111;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.4);">+</div>`,
                        className: '',
                        iconSize: [24, 24]
                    });
                    L.marker([lat, lon], { icon: pharmIcon })
                        .addTo(map)
                        .bindPopup(`<div style="color:#333;min-width:160px;font-family:sans-serif;">
                            <strong style="font-size:0.95rem;">${name}</strong><br>
                            <small style="color:#666;">${amenity}</small><br><br>
                            <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}" target="_blank"
                               style="display:inline-block;background:#FFD700;color:#111;font-weight:700;font-size:0.85rem;padding:6px 14px;border-radius:8px;text-decoration:none;">
                               &#10148; Navigate
                            </a>
                        </div>`);
                    bounds.push([lat, lon]);

                    const card = document.createElement('div');
                    card.className = 'store-card';
                    card.innerHTML = `
                        <h3><i class="fa-solid fa-house-medical" style="color:var(--lime-green);margin-right:6px;"></i>${name}</h3>
                        <div><i class="fa-solid fa-tag" style="color:var(--lime-green);"></i> ${amenity || 'Medical'}</div>
                        <div><i class="fa-solid fa-location-dot" style="color:var(--lime-green);"></i> ${address}</div>
                        <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}"
                           target="_blank" class="btn-navigate">
                            <i class="fa-solid fa-diamond-turn-right"></i> Navigate
                        </a>
                    `;
                    storesList.appendChild(card);
                });

                if (bounds.length > 0) map.fitBounds(bounds, { padding: [20, 20] });

            } else {
                storesList.innerHTML = `
                    <div style="text-align:center;padding:30px;">
                        <i class="fa-solid fa-map-location-dot" style="font-size:2.5rem;color:var(--lime-green);"></i>
                        <p style="margin-top:12px;">No stores found via OpenStreetMap in your area.</p>
                        <a href="https://www.google.com/maps/search/pharmacy+near+me" target="_blank"
                           class="btn btn-primary" style="display:inline-block;margin-top:15px;text-decoration:none;">
                           Open Google Maps
                        </a>
                    </div>`;
            }
        } catch (error) {
            console.error('Overpass error:', error);
            storesList.innerHTML = `
                <div style="text-align:center;padding:20px;">
                    <i class="fa-solid fa-wifi" style="font-size:2rem;color:#ff8f8f;"></i>
                    <p style="margin-top:10px;">Could not fetch store data. Check your internet connection.</p>
                    <a href="https://www.google.com/maps/search/pharmacy+near+me" target="_blank"
                       class="btn btn-primary" style="display:inline-block;margin-top:15px;text-decoration:none;">
                       Search on Google Maps
                    </a>
                </div>`;
        }
    }

    // --- History (Real-time) ---
    function populateHistory() {
        if (!currentUser) return;
        const q = fb.query(
            fb.collection(fb.db, 'searchHistory'),
            fb.where('userId', '==', currentUser.mobile),
            fb.orderBy('timestamp', 'desc')
        );

        fb.onSnapshot(q, (snapshot) => {
            if (!historyList) return;
            historyList.innerHTML = '';
            const historyDocs = snapshot.docs.map(doc => doc.data());

            if (historyDocs.length === 0) {
                historyList.innerHTML = '<p style="text-align:center; margin-top:20px;">No searches yet.</p>';
                return;
            }

            historyDocs.forEach(item => {
                const dateStr = item.timestamp ? item.timestamp.toDate().toLocaleString() : 'Just now';
                historyList.innerHTML += `
                    <div class="history-card">
                        <div class="date">${dateStr}</div>
                        <div class="symptom">Symptom: ${item.symptom}</div>
                        <div class="medicine" style="color:var(--lime-green); font-size:0.9rem;">Recommended: ${item.medicine}</div>
                    </div>
                `;
            });
        });
    }

    // --- Chatbot Logic ---
    function addChatMessage(text, sender) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}`;
        msgDiv.innerHTML = `<div class="msg-bubble">${text}</div>`;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const msg = chatInput.value.trim();
        if (!msg) return;

        addChatMessage(msg, 'user');
        chatInput.value = '';

        setTimeout(() => {
            const lowerMsg = msg.toLowerCase();
            let reply = "I'm sorry, I don't understand that. Try the 'Explore Symptoms' feature for illness recommendations.";

            if (lowerMsg.includes('hi') || lowerMsg.includes('hello')) {
                reply = "Hello! I am your AI Health Assistant. How are you feeling today?";
            } else if (lowerMsg.includes('fever') || lowerMsg.includes('hot')) {
                reply = "If you have a fever, please stay hydrated and monitor your temperature. If it exceeds 102°F or lasts more than 3 days, consult a doctor immediately.";
            } else if (lowerMsg.includes('headache')) {
                reply = "For headaches, try resting in a quiet, dark room and drinking water. If severe, a standard pain reliever might help.";
            } else if (lowerMsg.includes('doctor') || lowerMsg.includes('hospital')) {
                reply = "You can find nearby medical stores in the 'Nearby Stores' section, or use Google Maps to find a clinic.";
            } else if (lowerMsg.includes('medicine') || lowerMsg.includes('dose')) {
                reply = "Use the 'Explore Symptoms' feature to get medicine recommendations for your condition.";
            } else if (lowerMsg.includes('thank')) {
                reply = "You're welcome! Take care and stay healthy! 💚";
            }

            addChatMessage(reply, 'bot');
        }, 800);
    });

    // --- Dynamic Calendar ---
    function populateCalendar() {
        const calContainer = document.getElementById('dynamic-calendar');
        if (!calContainer) return;
        calContainer.innerHTML = '';
        const today = new Date();
        const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        for (let i = -2; i <= 2; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            const dayName = daysOfWeek[date.getDay()];
            const dayNum = date.getDate();
            const isActive = i === 0 ? 'active' : '';
            calContainer.innerHTML += `
                <div class="cal-day ${isActive}">
                    <span>${dayName}</span>
                    <strong>${dayNum}</strong>
                </div>
            `;
        }
    }

    // --- Image Slider ---
    function initSlider() {
        const slider = document.getElementById('main-slider');
        if (!slider) return;
        let currentSlide = 0;
        const totalSlides = 6;
        setInterval(() => {
            currentSlide = (currentSlide + 1) % totalSlides;
            slider.style.transform = `translateX(-${(currentSlide * 100) / totalSlides}%)`;
        }, 3000);
    }

    // ================= MEDICINE SCHEDULE & NOTIFICATIONS =================

    const reminderForm = document.getElementById('reminder-form');
    const remindersList = document.getElementById('reminders-list');
    const bellBtn = document.getElementById('bell-icon-btn');
    const notifDropdown = document.getElementById('notifications-dropdown');
    const notifBadge = document.getElementById('notification-badge');
    const notifList = document.getElementById('notifications-list');

    // Fetch Reminders (Real-time)
    function fetchReminders() {
        if (!currentUser) return;
        const q = fb.query(
            fb.collection(fb.db, 'reminders'),
            fb.where('userId', '==', currentUser.mobile),
            fb.orderBy('timestamp', 'desc')
        );
        fb.onSnapshot(q, (snapshot) => {
            activeReminders = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            renderReminders();
        });
    }

    function renderReminders() {
        if (!remindersList) return;
        remindersList.innerHTML = '';
        if (activeReminders.length === 0) {
            remindersList.innerHTML = '<p style="text-align:center;color:rgba(255,255,255,0.6);">No active reminders. Add one above.</p>';
            return;
        }

        activeReminders.forEach(r => {
            const card = document.createElement('div');
            card.className = 'reminder-card';

            // Format time for display (convert 24h to 12h AM/PM if desired, but keeping it simple)
            let timeStr = r.time;
            try {
                let [h, m] = r.time.split(':');
                let ampm = h >= 12 ? 'PM' : 'AM';
                h = h % 12 || 12;
                timeStr = `${h}:${m} ${ampm}`;
            } catch (e) { }

            card.innerHTML = `
                <div class="reminder-info">
                    <h3>${r.medicine_name}</h3>
                    <p><i class="fa-regular fa-clock"></i> Scheduled at ${timeStr}</p>
                </div>
                <button class="btn-delete-reminder" data-id="${r.id}"><i class="fa-solid fa-trash"></i></button>
            `;
            remindersList.appendChild(card);
        });

        // Add delete event listeners
        document.querySelectorAll('.btn-delete-reminder').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                try {
                    await fb.deleteDoc(fb.doc(fb.db, 'reminders', id));
                    // No need to call fetchReminders(), onSnapshot handles it!
                } catch (err) {
                    console.error("Error deleting reminder", err);
                }
            });
        });
    }

    // Add Reminder
    if (reminderForm) {
        reminderForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const medName = document.getElementById('med-name-input').value;
            const medTime = document.getElementById('med-time-input').value;

            try {
                await fb.addDoc(fb.collection(fb.db, 'reminders'), {
                    userId: currentUser.mobile,
                    medicine_name: medName,
                    time: medTime,
                    timestamp: fb.serverTimestamp()
                });
                reminderForm.reset();
                // onSnapshot will refresh the list automatically
            } catch (err) {
                console.error("Error adding reminder", err);
            }
        });
    }

    // Notifications
    // Notifications (Real-time)
    function fetchNotifications() {
        if (!currentUser) return;
        const q = fb.query(
            fb.collection(fb.db, 'notifications'),
            fb.where('userId', '==', currentUser.mobile),
            fb.orderBy('timestamp', 'desc')
        );
        fb.onSnapshot(q, (snapshot) => {
            const notifs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            renderNotifications(notifs);
        });
    }

    function renderNotifications(notifs) {
        if (!notifList) return;
        notifList.innerHTML = '';
        let unreadCount = 0;

        if (notifs.length === 0) {
            notifList.innerHTML = '<div style="padding:15px;text-align:center;color:#5f6368;">No notifications</div>';
        } else {
            notifs.forEach(n => {
                if (!n.is_read) unreadCount++;
                const item = document.createElement('div');
                item.className = `notif-card ${!n.is_read ? 'unread' : ''}`;
                item.innerHTML = `
                    <div class="notif-card-header">
                        <i class="fa-solid fa-message" style="color: #1a73e8; font-size: 0.8rem;"></i>
                        <span class="notif-app">Reminders</span>
                        <span class="notif-dot">&bull;</span>
                        <span class="notif-time">now</span>
                        <i class="fa-solid fa-chevron-down notif-chevron"></i>
                    </div>
                    <div class="notif-card-body">
                        <div class="notif-content">
                            <div class="notif-title">${n.medicine_name}</div>
                            <div class="notif-message">${n.message}</div>
                        </div>
                    </div>
                `;
                notifList.appendChild(item);
            });
        }

        if (notifBadge) {
            if (unreadCount > 0) {
                notifBadge.textContent = unreadCount;
                notifBadge.classList.remove('hidden');
            } else {
                notifBadge.classList.add('hidden');
            }
        }
    }

    // Bell Icon click
    if (bellBtn) {
        bellBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            notifDropdown.classList.toggle('hidden');

            if (!notifDropdown.classList.contains('hidden') && notifBadge && !notifBadge.classList.contains('hidden')) {
                // Mark all as read in Firestore
                try {
                    const q = fb.query(
                        fb.collection(fb.db, 'notifications'),
                        fb.where('userId', '==', currentUser.mobile),
                        fb.where('is_read', '==', false)
                    );
                    const snapshot = await fb.getDocs(q);
                    const batchPromises = snapshot.docs.map(d =>
                        fb.updateDoc(fb.doc(fb.db, 'notifications', d.id), { is_read: true })
                    );
                    await Promise.all(batchPromises);
                } catch (err) {
                    console.error("Error marking read", err);
                }
            }
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (notifDropdown && !notifDropdown.classList.contains('hidden') && !bellBtn.contains(e.target) && !notifDropdown.contains(e.target)) {
            notifDropdown.classList.add('hidden');
        }
    });

    // Time Checker
    let lastCheckedMinute = -1;

    function showToastNotification(medicineName, dateStr) {
        let toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            const appContainer = document.getElementById('app-container');
            if (appContainer) {
                appContainer.appendChild(toastContainer);
            } else {
                document.body.appendChild(toastContainer);
            }
        }

        const toast = document.createElement('div');
        toast.className = 'glass-pill-toast';
        toast.innerHTML = `
            <div class="glass-pill-avatar">
                <i class="fa-solid fa-user"></i>
            </div>
            <div class="glass-pill-content">
                <div class="glass-pill-header">
                    <span class="glass-pill-title">Reminder</span>
                    <span class="glass-pill-time">${dateStr}</span>
                </div>
                <div class="glass-pill-desc">It's time to take ${medicineName}!</div>
            </div>
        `;
        toastContainer.appendChild(toast);

        // Auto remove after 5 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-20px)';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    }

    function startReminderCheck() {
        if (notificationCheckInterval) clearInterval(notificationCheckInterval);

        notificationCheckInterval = setInterval(() => {
            if (activeReminders.length === 0) return;

            const now = new Date();
            const currentHour = now.getHours().toString().padStart(2, '0');
            const currentMin = now.getMinutes().toString().padStart(2, '0');
            const currentTimeStr = `${currentHour}:${currentMin}`;

            // Only trigger once per minute
            if (now.getMinutes() === lastCheckedMinute) return;

            let triggered = false;

            activeReminders.forEach(r => {
                if (r.time === currentTimeStr) {
                    triggered = true;
                    // Show custom glass toast notification
                    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    showToastNotification(r.medicine_name, dateStr);

                    // Save to Firestore notifications
                    fb.addDoc(fb.collection(fb.db, 'notifications'), {
                        userId: currentUser.mobile,
                        medicine_name: r.medicine_name,
                        message: `Time to take your medicine.`,
                        is_read: false,
                        timestamp: fb.serverTimestamp()
                    });
                }
            });

            if (triggered) {
                lastCheckedMinute = now.getMinutes();
            }

        }, 10000); // Check every 10 seconds to not miss the minute
    }

    // Initialize on load
    populateCalendar();
    initSlider();

});
