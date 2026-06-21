import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, orderBy } from "firebase/firestore";

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyAKrgr2spNasTfvAE3n-WdFJmG4R84Vdvw",
    authDomain: "smart-healthcare-ac042.firebaseapp.com",
    projectId: "smart-healthcare-ac042",
    storageBucket: "smart-healthcare-ac042.firebasestorage.app",
    messagingSenderId: "187672282456",
    appId: "1:187672282456:web:5e964a9429f28d92c5912d",
    measurementId: "G-WB28D9TBE5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

document.addEventListener('DOMContentLoaded', () => {

    // --- State Management ---
    let currentUser = null;
    let searchHistory = [];

    // --- Map Variables (Leaflet) ---
    let map;
    let markersLayer = null;
    let userLocation = { lat: 20.5937, lng: 78.9629 }; // Default
    let medicineReminders = [];
    let notifications = [];

    // --- Symptom Database removed (now using backend API) ---

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

    // Advanced Features
    const bellBtn = document.getElementById('bell-btn');
    const bellBadge = document.getElementById('bell-badge');
    const notifModal = document.getElementById('notification-modal');
    const notifHistoryList = document.getElementById('notification-history-list');
    const closeNotifBtn = document.getElementById('close-notifications');
    const toast = document.getElementById('notification-toast');
    const toastTitle = document.getElementById('toast-title');
    const toastMsg = document.getElementById('toast-msg');
    const toastActionReply = document.getElementById('toast-action-reply');
    const toastActionArchive = document.getElementById('toast-action-archive');
    const reminderForm = document.getElementById('reminder-form');
    const remindersList = document.getElementById('reminders-list');

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
        if (targetViewId === 'reminders-view') fetchRemindersFromFirestore();
    }

    backBtn.addEventListener('click', () => switchView('dashboard-view'));
    logoutBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/logout', { method: 'POST' });
        } catch (e) {
            console.error('Logout error:', e);
        }
        currentUser = null;
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

    // --- Notification Service ---
    function formatTimeAMPM(time24) {
        if (!time24) return "";
        let [hours, minutes] = time24.split(':');
        let ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12; // the hour '0' should be '12'
        return hours + ':' + minutes + ' ' + ampm;
    }

    function startNotificationService() {
        setInterval(() => {
            const now = new Date();
            const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

            medicineReminders.forEach(rem => {
                if (rem.time === currentTime && !rem.notified) {
                    triggerNotification(`Time for your medicine: ${rem.medicineName}`);
                    rem.notified = true; // Avoid duplicate alerts in same minute
                }
            });
        }, 10000); // Check every 10 seconds
    }

    function triggerNotification(message) {
        // Update bell badge and history
        bellBadge.classList.remove('hidden');
        const now = new Date();
        const timeStr = formatTimeAMPM(`${now.getHours()}:${now.getMinutes()}`);
        notifications.push({ msg: message, time: timeStr });

        // Show Custom Toast
        toastTitle.innerText = "SmartHealth Reminder";
        toastMsg.innerText = message;
        toast.classList.remove('hidden');

        // Auto-dismiss after 10 seconds
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 10000);

        console.log("HEALTH ALERT:", message);
    }

    toastActionReply.addEventListener('click', () => {
        toast.classList.add('hidden');
        switchView('reminders-view');
    });

    toastActionArchive.addEventListener('click', () => {
        toast.classList.add('hidden');
    });

    bellBtn.addEventListener('click', () => {
        openNotificationModal();
    });

    closeNotifBtn.addEventListener('click', () => {
        notifModal.classList.add('hidden');
    });

    function openNotificationModal() {
        notifModal.classList.remove('hidden');
        bellBadge.classList.add('hidden');
        renderNotificationHistory();
    }

    function renderNotificationHistory() {
        notifHistoryList.innerHTML = '';
        if (notifications.length === 0) {
            notifHistoryList.innerHTML = '<p class="empty-msg">No notifications yet.</p>';
            return;
        }
        [...notifications].reverse().forEach(n => {
            notifHistoryList.innerHTML += `
                <div class="notif-item">
                    <div class="notif-time">${n.time}</div>
                    <div class="notif-msg">${n.msg}</div>
                </div>
            `;
        });
    }

    startNotificationService();

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
            // Firestore Login Check
            const userDoc = await getDoc(doc(db, "users", mobile));

            if (userDoc.exists()) {
                const userData = userDoc.data();
                // Simple password check (In production, use Firebase Auth or hashing)
                if (userData.password === password) {
                    currentUser = { mobile: mobile };
                    switchView('dashboard-view');
                    // Fetch history from Firestore
                    fetchHistoryFromFirestore();
                } else {
                    alert('Invalid password');
                }
            } else {
                alert('User not found');
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
            // Check if user exists
            const userDoc = await getDoc(doc(db, "users", mobile));
            if (userDoc.exists()) {
                alert("Mobile number already registered!");
                return;
            }

            // Save to Firestore
            await setDoc(doc(db, "users", mobile), {
                mobile: mobile,
                password: password, // Simple storage for demo
                createdAt: new Date()
            });

            alert("Registration Successful! Please login.");
            registerForm.classList.add('hidden');
            loginForm.classList.remove('hidden');
        } catch (error) {
            console.error('Error registering:', error);
            alert('An error occurred during registration. Please try again.');
        }
    });


    // --- Explore Symptoms Logic ---
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
                // Display results from backend
                document.getElementById('res-illness').textContent = result.illness;
                document.getElementById('res-medicine').textContent = result.medicine;
                document.getElementById('res-usage').textContent = result.how;
                document.getElementById('res-timing').textContent = result.when;
                document.getElementById('res-precautions').textContent = result.precautions;

                recommendationResult.classList.remove('hidden');

                // Save Search History to Firestore
                if (currentUser) {
                    await addDoc(collection(db, "history"), {
                        user_mobile: currentUser.mobile,
                        symptom: symptoms,
                        medicine: result.medicine,
                        date: new Date()
                    });
                    // Refresh local history state if needed
                    fetchHistoryFromFirestore();
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
            alert('An error occurred. Please make sure the backend server is running.');
        }
    });

    // --- Leaflet Map Integration ---
    function initMap() {
        if (!window.L) return;

        // Cleanup if map already exists
        if (map) {
            map.remove();
            map = null;
        }

        if (navigator.geolocation) {
            storesList.innerHTML = '<div style="text-align:center; padding:20px;"><i class="fa-solid fa-location-crosshairs fa-beat"></i> Determining your current location...</div>';
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    userLocation = {
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                    };
                    renderLeafletMap();
                },
                (error) => {
                    console.warn("Geolocation failed:", error.message);
                    storesList.innerHTML = `
                        <div style="text-align:center; padding:20px; color: #ff6b6b;">
                            <i class="fa-solid fa-location-dot" style="font-size: 2rem;"></i>
                            <p style="margin-top:10px;">Could not find your exact location. Please enable GPS/Location in your browser settings to see stores within 3km.</p>
                        </div>
                    `;
                    renderLeafletMap(); // Still render with default
                }
            );
        } else {
            renderLeafletMap();
        }
    }

    function renderLeafletMap() {
        map = L.map('map').setView([userLocation.lat, userLocation.lng], 14);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        // Custom icon for user location
        const userIcon = L.divIcon({
            html: '<div style="background-color: #6366f1; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>',
            className: 'user-location-icon',
            iconSize: [12, 12]
        });

        L.marker([userLocation.lat, userLocation.lng], { icon: userIcon })
            .addTo(map)
            .bindPopup("Your Location")
            .openPopup();

        searchNearbyPharmacies();
    }

    async function searchNearbyPharmacies() {
        storesList.innerHTML = '<div style="text-align:center; padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i> Searching for all local pharmacies...</div>';

        // Overpass API Query - Searching for multiple medical types (Completely Free)
        const overpassUrl = 'https://overpass-api.de/api/interpreter';
        const query = `
            [out:json][timeout:25];
            (
              node["amenity"~"pharmacy|hospital|clinic|doctors"](around:5000, ${userLocation.lat}, ${userLocation.lng});
              way["amenity"~"pharmacy|hospital|clinic|doctors"](around:5000, ${userLocation.lat}, ${userLocation.lng});
              node["shop"~"medical_supply|chemist|drugstore|optician"](around:5000, ${userLocation.lat}, ${userLocation.lng});
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
                const markers = [];

                results.forEach(place => {
                    const lat = place.lat || (place.center ? place.center.lat : null);
                    const lon = place.lon || (place.center ? place.center.lon : null);
                    if (!lat || !lon) return;

                    const name = place.tags.name || "Medical Store";
                    const address = place.tags["addr:street"] || place.tags.vicinity || "Nearby your location";

                    const marker = L.marker([lat, lon]).addTo(map)
                        .bindPopup(`<div style="color:#333; min-width:150px;"><strong>${name}</strong><br><p style="font-size:0.8rem;">${address}</p><a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}" target="_blank" style="color:blue;">Navigate</a></div>`);
                    markers.push([lat, lon]);

                    const card = document.createElement('div');
                    card.className = 'store-card';
                    card.innerHTML = `
                        <h3>${name}</h3>
                        <div><i class="fa-solid fa-location-dot" style="color: var(--lime-green);"></i> ${address}</div>
                        <div style="margin-top: 10px;">
                            <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}" target="_blank" class="btn-navigate"><i class="fa-solid fa-diamond-turn-right"></i> Navigate</a>
                        </div>
                    `;
                    storesList.appendChild(card);
                });

                if (markers.length > 0) map.fitBounds(markers, { padding: [20, 20] });

            } else {
                storesList.innerHTML = `
                    <div style="text-align:center; padding:30px;">
                        <i class="fa-solid fa-map-location-dot" style="font-size: 2rem;"></i>
                        <p style="margin-top:10px;">No stores found on OpenStreetMap. Use Google Maps directly for better local results:</p>
                        <a href="https://www.google.com/maps/search/pharmacy+near+me" target="_blank" class="btn btn-primary" style="display:inline-block; margin-top:15px; text-decoration:none;">Open Google Maps Search</a>
                    </div>
                `;
            }
        } catch (error) {
            storesList.innerHTML = '<p style="text-align:center; padding:20px;">Connection Error. Trying to reload...</p>';
        }
    }

    // --- Firestore History Functions ---
    async function fetchHistoryFromFirestore() {
        if (!currentUser) return;

        try {
            const q = query(
                collection(db, "history"),
                where("user_mobile", "==", currentUser.mobile)
                // Removed orderBy to avoid requiring a composite index in Firestore
            );

            const querySnapshot = await getDocs(q);
            searchHistory = [];
            querySnapshot.forEach((doc) => {
                const data = doc.data();
                searchHistory.push({
                    date: data.date.toDate(),
                    symptom: data.symptom,
                    medicine: data.medicine
                });
            });

            // Sort client-side by date descending
            searchHistory.sort((a, b) => b.date - a.date);

            // Format dates for display
            searchHistory = searchHistory.map(item => ({
                ...item,
                date: item.date.toLocaleString()
            }));

            populateHistory();
        } catch (error) {
            console.error("Error fetching history:", error);
        }
    }

    // --- History UI ---
    function populateHistory() {
        historyList.innerHTML = '';
        if (searchHistory.length === 0) {
            historyList.innerHTML = '<p style="text-align:center; margin-top:20px;">No searches yet.</p>';
            return;
        }

        searchHistory.forEach(item => {
            historyList.innerHTML += `
                <div class="history-card">
                    <div class="date">${item.date}</div>
                    <div class="symptom">Symptom: ${item.symptom}</div>
                    <div class="medicine" style="color:var(--text-muted); font-size:0.9rem;">Recommended: ${item.medicine}</div>
                </div>
            `;
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

        // User message
        addChatMessage(msg, 'user');
        chatInput.value = '';

        // Bot response delay
        setTimeout(() => {
            const lowerMsg = msg.toLowerCase();
            let reply = "I'm sorry, I don't understand that perfectly. However, I can help you with symptoms, vitals, or finding a hospital. Try saying 'I have a fever' or 'Track my vitals'.";

            if (lowerMsg.includes('hi') || lowerMsg.includes('hello')) {
                reply = "Hello! I am your AI Health Assistant. How are you feeling today?";
            } else if (lowerMsg.includes('fever') || lowerMsg.includes('hot')) {
                reply = "If you have a fever, please stay hydrated and monitor your temperature. I recommend using the 'Explore Symptoms' tool for a detailed analysis.";
            } else if (lowerMsg.includes('headache')) {
                reply = "For headaches, try resting in a quiet, dark room. If it's persistent, you might want to log your Blood Pressure in the 'Health Vitals' section.";
            } else if (lowerMsg.includes('vitals') || lowerMsg.includes('track') || lowerMsg.includes('weight')) {
                reply = "You can track your health trends in the 'Health Vitals' section. Would you like to log your vitals now?";
            } else if (lowerMsg.includes('doctor') || lowerMsg.includes('hospital') || lowerMsg.includes('emergency')) {
                reply = "In case of an emergency, please use the red SOS button on your dashboard. I can also help you find nearby pharmacies in the 'Nearby Stores' section.";
            } else if (lowerMsg.includes('medicine') || lowerMsg.includes('dose') || lowerMsg.includes('reminder')) {
                reply = "You can manage your medications in the 'Medicine Schedule' section to ensure you never miss a dose.";
            } else if (lowerMsg.includes('thank')) {
                reply = "You're welcome! I'm here to help you stay healthy.";
            }

            addChatMessage(reply, 'bot');

            // Add Quick Action Buttons after certain replies
            if (lowerMsg.includes('vitals') || lowerMsg.includes('track')) {
                addQuickActions([
                    { text: 'Log Vitals', target: 'vitals-view' },
                    { text: 'See History', target: 'history-view' }
                ]);
            } else if (lowerMsg.includes('fever') || lowerMsg.includes('headache')) {
                addQuickActions([
                    { text: 'Analyze Symptoms', target: 'explore-view' },
                    { text: 'Nearby Stores', target: 'stores-view' }
                ]);
            }
        }, 800);
    });

    function addQuickActions(actions) {
        const actionDiv = document.createElement('div');
        actionDiv.className = 'message bot';
        let buttonsHtml = '<div class="msg-bubble quick-actions" style="background:none; border:none; padding:0; display:flex; gap:10px; flex-wrap:wrap;">';
        actions.forEach(action => {
            buttonsHtml += `<button class="btn btn-primary" style="padding:8px 12px; font-size:0.8rem;" onclick="document.dispatchEvent(new CustomEvent('nav-to', {detail: '${action.target}'}))">${action.text}</button>`;
        });
        buttonsHtml += '</div>';
        actionDiv.innerHTML = buttonsHtml;
        chatMessages.appendChild(actionDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Global listener for quick actions
    document.addEventListener('nav-to', (e) => {
        switchView(e.detail);
    });

    // --- Dynamic Calendar Logic ---
    function populateCalendar() {
        const calContainer = document.getElementById('dynamic-calendar');
        if (!calContainer) return;

        calContainer.innerHTML = '';
        const today = new Date();
        const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

        // Populate 2 days before, today, and 2 days after
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

    // Initialize calendar on load
    populateCalendar();

    // --- Image Slider Logic ---
    function initSlider() {
        const slider = document.getElementById('main-slider');
        if (!slider) return;

        let currentSlide = 0;
        const totalSlides = 3;

        setInterval(() => {
            currentSlide = (currentSlide + 1) % totalSlides;
            slider.style.transform = `translateX(-${(currentSlide * 100) / totalSlides}%)`;
        }, 3000);
    }

    // --- Medicine Reminders Logic ---
    async function fetchRemindersFromFirestore() {
        if (!currentUser) return;
        try {
            const q = query(collection(db, "reminders"), where("user_mobile", "==", currentUser.mobile));
            const snapshot = await getDocs(q);
            medicineReminders = [];
            snapshot.forEach(doc => {
                medicineReminders.push({ id: doc.id, ...doc.data(), notified: false });
            });
            renderRemindersList();
        } catch (e) { console.error("Reminders fetch error:", e); }
    }

    reminderForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('rem-med-name').value;
        const time = document.getElementById('rem-time').value;

        if (currentUser) {
            await addDoc(collection(db, "reminders"), {
                user_mobile: currentUser.mobile,
                medicineName: name,
                time: time
            });
            reminderForm.reset();
            fetchRemindersFromFirestore();
        }
    });

    function renderRemindersList() {
        remindersList.innerHTML = '';
        if (medicineReminders.length === 0) {
            remindersList.innerHTML = '<p style="text-align:center; padding:20px;">No reminders set.</p>';
            return;
        }
        medicineReminders.forEach(r => {
            remindersList.innerHTML += `
                <div class="reminder-card">
                    <div class="rem-info">
                        <h4>${r.medicineName}</h4>
                        <p class="time"><i class="fa-solid fa-clock"></i> ${formatTimeAMPM(r.time)}</p>
                    </div>
                </div>
            `;
        });
    }

    initSlider();

});




