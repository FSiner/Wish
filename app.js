<script type="importmap">
        {
            "imports": {
                "firebase/app": "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js",
                "firebase/firestore": "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js",
                "firebase/database": "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js"
            }
        }
    </script>
<script type="module">
    import { initializeApp } from "firebase/app";
    import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, getDocs, where, deleteDoc } from "firebase/firestore";
    import { getDatabase, ref, set, onValue, update, onDisconnect } from "firebase/database";

    const firebaseConfig = {
        apiKey: "AIzaSyCxj9RKhbsP04SESCfLNyp_QbIPssDXJFA",
        authDomain: "wish-1b853.firebaseapp.com",
        projectId: "wish-1b853",
        storageBucket: "wish-1b853.firebasestorage.app",
        messagingSenderId: "629417355340",
        appId: "1:629417355340:web:08f16592fc48bbfc14ace9",
        measurementId: "G-NKTJZEHYQ6"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const rdb = getDatabase(app);

    // 💾 요구사항: 새로고침 시 "과거 완료된 기록 폴더"만 로드하고, 현재 게임 진행 상황은 일절 저장/불러오지 않고 0으로 완전히 초기화!
    let historyFolders = JSON.parse(localStorage.getItem('genshin_sim_folders')) || [];

    // 🧼 [핵심] 현재 판 데이터는 로컬 스토리지 무시하고 언제나 완벽하게 '0' 상태에서 태초로 시작!
    let globalStats = { pity5: 0, pity4: 0, totalPulls: 0, isGuaranteed: false, radianceStack: 0, results5: [], pickupCount: -1 };
    let savedArchive = []; // 이번 판에 얻은 5성 임시 배열
    
    const COST_PER_PULL = 2410;
    const CHICKEN_PRICE = 20000;
    
    let myName = ""; // 새로고침 시 언제나 다시 등록하도록 강제함
    let currentRoomId = null;
    let isFinishedC6 = false; 
    let isHost = false;
    let isMultiplayerMode = false;
    let isGameStarted = true;

    window.handleWish = handleWish;
    window.revealAll = revealAll;
    window.flipCard = flipCard;
    window.submitInitialName = submitInitialName;
    window.changeNickname = changeNickname;
    window.createRoom = createRoom;
    window.joinRoom = joinRoom;
    window.startGame = startGame;
    window.closeC6Cutscene = closeC6Cutscene;

    window.onload = function() {
        // 🔄 새로고침 완료 시 항상 이름 입력 모달이 대기하고 있도록 보장
        document.getElementById('nameModal').style.display = 'flex';
        document.getElementById('editNickInput').value = "로딩 중...";
        document.getElementById('btn1').disabled = true;
        document.getElementById('btn10').disabled = true;
        syncUI();
        renderArchiveFolders(); // 과거의 추억 폴더 목록은 그대로 렌더링!
        calculateMyRank();
    };

    // 🔔 커스텀 토스트 알림창 출력 함수 (alert 방지용 우아한 인터페이스)
    function showToast(message) {
        const container = document.getElementById('toastContainer');
        if(!container) return;
        const toast = document.createElement('div');
        toast.className = 'custom-toast';
        toast.innerText = message;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 50);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function saveToLocalStorage() {
        // [중요] 현재 진행중인 게임 수치는 절대 저장하지 않음으로써 다음 새로고침 시 영구 초기화를 보증함!
    }

    // 캐릭터 이스터에그 정의
const resonance = {
    "라이덴": { e: "effect-raiden" }, "Raiden": { e: "effect-raiden" },
    "나히다": { e: "effect-nahida" }, "Nahida": { e: "effect-nahida" },
    "푸리나": { e: "effect-furina" }, "Furina": { e: "effect-furina" },
    "느비예트": { e: "effect-neuvillette" }, "Neuvillette": { e: "effect-neuvillette" },
    "종려": { e: "effect-zhongli" }, "Zhongli": { e: "effect-zhongli" }
};

function submitInitialName() {
    const input = document.getElementById('modalNameInput');
    if(!input || !input.value.trim()) return showToast("사용할 이름을 입력해 주세요!");
    
    myName = input.value.trim();
    
    // 이스터에그 체크
    if (resonance[myName]) {
        document.body.className = resonance[myName].e;
        showToast(`원소 공명 발생! ${myName}의 강력한 이펙트가 활성화됩니다!`);
    } else {
        document.body.className = '';
    }

    document.getElementById('editNickInput').value = myName;
    document.getElementById('nameModal').style.display = 'none';
    document.getElementById('btn1').disabled = false;
    document.getElementById('btn10').disabled = false;
    syncUI();
    renderArchiveFolders();
    showToast(`어서와, ${myName}! 행운이 가득하길 바랄게! 🍀`);
}

    function changeNickname() {
        const newName = document.getElementById('editNickInput').value.trim();
        if(!newName) return showToast("이름은 공백일 수 없습니다!");
        myName = newName;
        showToast("닉네임이 성공적으로 변경되었습니다!");
        syncMultiplayerStatus();
        calculateMyRank();
    }

    // 🏆 명예의 전당 갱신 처리 (동일 이름 중 '최고 기록'으로만 치환)
    async function checkAndUploadC6() {
        if(globalStats.pickupCount >= 6 && !isFinishedC6) {
            isFinishedC6 = true;
            playC6Cutscene();

            // 이번 판이 무사히 풀돌로 끝났으니, 하나의 소중한 기록 파일(폴더)로 밀봉해서 브라우저 아카이브에 영구 저장!
            saveCurrentGameToFolder();

            const myUsedGems = globalStats.totalPulls * 160;
            try {
                // 1. 현재 입력한 닉네임과 똑같은 명예의 전당 기록이 있는지 서치
                const q = query(collection(db, "c6_rankings"), where("name", "==", myName));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    let existingDoc = querySnapshot.docs[0];
                    let existingGems = existingDoc.data().usedGems;

                    // 2. 만약 이미 기록이 있는데 이번에 원석을 "더 적게" 써서 운 좋게 깼다면 기존 기록 삭제 후 새 최고기록 등극!
                    if (myUsedGems < existingGems) {
                        await deleteDoc(existingDoc.ref);
                        await addDoc(collection(db, "c6_rankings"), { 
                            name: myName, 
                            pulls: globalStats.totalPulls, 
                            usedGems: myUsedGems, 
                            timestamp: Date.now() 
                        });
                        showToast("🎉 축하해! 기존의 내 기록을 뛰어넘어 새로운 최단 기록을 명예의 전당에 세웠어!");
                    } else {
                        showToast("이번에도 멋진 도전이었어! 하지만 아쉽게도 내 기존 랭킹 기록보다는 원석을 더 썼네 😅");
                    }
                } else {
                    // 3. 기존에 등록된 기록이 없다면 최초 기록으로 바로 명예의 전당 박제!
                    await addDoc(collection(db, "c6_rankings"), { 
                        name: myName, 
                        pulls: globalStats.totalPulls, 
                        usedGems: myUsedGems, 
                        timestamp: Date.now() 
                    });
                    showToast("🎉 명예의 전당에 첫 깃발을 꽂았어! 전당 리스트를 확인해봐!");
                }
            } catch (e) { console.error("명예의 전당 검증 중 데이터 통신 실패:", e); }
        }
    }

    // 📁 이번 판의 뽑기 이력을 하나의 폴더 상자로 구성해서 로컬 아카이브에 보관하는 메커니즘
    function saveCurrentGameToFolder() {
        const totalWon = globalStats.totalPulls * COST_PER_PULL;
        const newFolder = {
            gameId: "GAME-" + Date.now(),
            playerName: myName || "무명 여행자",
            totalPulls: globalStats.totalPulls,
            totalGems: globalStats.totalPulls * 160,
            totalWon: totalWon,
            chickenCount: (totalWon / CHICKEN_PRICE).toFixed(1),
            date: new Date().toLocaleDateString(),
            characters: [...savedArchive] // 5성들 이력 캡처
        };
        
        historyFolders.unshift(newFolder); // 신규 폴더가 위로 가게 삽입
        localStorage.setItem('genshin_sim_folders', JSON.stringify(historyFolders));
        renderArchiveFolders();
    }

    // 🗺️ 하단 도감 그리드 영역을 이쁘장한 '플레이 폴더' 리스트 뷰형태로 복원 및 렌더링
    function renderArchiveFolders() {
        const grid = document.getElementById('archiveGrid');
        if(!grid) return;
        grid.innerHTML = '';

        if(historyFolders.length === 0) {
            grid.innerHTML = `<div style="color:#555; font-size:0.9em; padding:20px 0;">아직 보관된 시뮬레이터 기록 폴더가 없습니다. 첫 풀돌(C6)에 도전해 폴더를 획득해 보세요! 🎁</div>`;
            return;
        }

        historyFolders.forEach((folder, idx) => {
            const folderWrapper = document.createElement('div');
            folderWrapper.className = 'history-folder-box';

            let headerHtml = `
                <div class="folder-header">
                    <span class="folder-title">📁 플레이 기록 폴더 #${historyFolders.length - idx} (${folder.playerName})</span>
                    <span class="folder-meta">📅 달성일: ${folder.date} | 📊 결과: <b>${folder.totalPulls}</b>뽑 (₩${folder.totalWon.toLocaleString()})</span>
                </div>
            `;

            let charListHtml = `<div class="folder-char-list">`;
            let pCount = -1;
            
            folder.characters.forEach(char => {
                let cLabel = "";
                if(char.isPickup) {
                    pCount++;
                    cLabel = pCount >= 6 ? "풀돌" : "C" + pCount;
                }
                charListHtml += `
                    <div class="mini-char-card" style="background:${char.isRadiance ? 'linear-gradient(to top, #ff4ef0, #fff)' : 'linear-gradient(to top, #ffcc00, #fff)'};">
                        ${char.name}
                        <span class="mini-char-stack">${char.stack}스택</span>
                        ${char.isPickup ? `<span class="mini-char-badge">${cLabel}</span>` : ''}
                    </div>
                `;
            });
            charListHtml += `</div>`;

            folderWrapper.innerHTML = headerHtml + charListHtml;
            grid.appendChild(folderWrapper);
        });
    }

    async function calculateMyRank() {
        if(globalStats.pickupCount < 6) {
            document.getElementById('myRealRank').innerText = "C6 미달성";
            return;
        }
        const myUsedGems = globalStats.totalPulls * 160;
        const q = query(collection(db, "c6_rankings"), orderBy("usedGems", "asc"));
        const snapshot = await getDocs(q);
        let rank = 1;
        let found = false;
        snapshot.forEach((doc) => {
            if(!found && doc.data().usedGems < myUsedGems) {
                rank++;
            }
        });
        document.getElementById('myRealRank').innerText = rank + " 위";
    }

    function listenRankings() {
        const q = query(collection(db, "c6_rankings"), orderBy("usedGems", "asc"), limit(50));
        onSnapshot(q, (snapshot) => {
            const rankList = document.getElementById('rankList');
            if(!rankList) return;
            rankList.innerHTML = '';
            let rank = 1;
            
            let seenNames = new Set();
            snapshot.forEach((doc) => {
                const data = doc.data();
                if(!seenNames.has(data.name)){
                    seenNames.add(data.name);
                    const item = document.createElement('div');
                    item.className = 'room-user-item';
                    item.innerHTML = `<span><b>${rank}위.</b> ${data.name}</span><span style="color:var(--gold)">${data.usedGems.toLocaleString()}개 (${data.pulls}뽑)</span>`;
                    rankList.appendChild(item);
                    rank++;
                }
            });
            if(rank === 1) rankList.innerHTML = `<div style="color:#666; text-align:center; padding-top:20px;">최초의 C6에 도전해보세요! 🚀</div>`;
            calculateMyRank();
        });
    }
    listenRankings();

    function createRoom() {
        if(!myName) return showToast("이름을 먼저 입력해주셔야 방을 생성할 수 있어! 👤");
        const roomId = Math.floor(100000 + Math.random() * 900000).toString();
        currentRoomId = roomId; isHost = true; isMultiplayerMode = true; isGameStarted = false;
        set(ref(rdb, `rooms/${roomId}/info`), { host: myName, status: "waiting" });
        document.getElementById('hostControlArea').style.display = 'block';
        document.getElementById('btn1').disabled = document.getElementById('btn10').disabled = true;
        
        const overlay = document.getElementById('multiNoticeOverlay');
        if(overlay) {
            document.getElementById('multiNoticeText').innerText = "다른 대결 상대를 기다리고 있습니다.\n방장이 [대결 시작하기]를 누르면 대결이 시작됩니다.";
            overlay.style.display = 'flex';
        }
        joinRoomSequence(roomId);
    }

    function joinRoom() {
        const codeInput = document.getElementById('roomCodeInput');
        if(!codeInput || !codeInput.value.trim()) return showToast("방 코드를 바르게 기입해줘! 🔢");
        currentRoomId = codeInput.value.trim(); isHost = false; isMultiplayerMode = true; isGameStarted = false;
        document.getElementById('btn1').disabled = document.getElementById('btn10').disabled = true;
        
        const overlay = document.getElementById('multiNoticeOverlay');
        if(overlay) {
            document.getElementById('multiNoticeText').innerText = "방장이 대결을 시작할 때까지 대기 중입니다...";
            overlay.style.display = 'flex';
        }
        joinRoomSequence(currentRoomId);
    }

    function joinRoomSequence(roomId) {
        document.getElementById('activeRoomInfo').innerText = `접속된 방 코드: ${roomId}`;
        document.getElementById('btnCreateRoom').disabled = document.getElementById('btnJoinRoom').disabled = document.getElementById('roomCodeInput').disabled = true;

        const myStatusRef = ref(rdb, `rooms/${roomId}/users/${myName}`);
        set(myStatusRef, { name: myName, pulls: globalStats.totalPulls, constLevel: getConstLabel(), pity5: globalStats.pity5, lastUpdate: Date.now() });
        onDisconnect(myStatusRef).remove();
        onValue(ref(rdb, `rooms/${roomId}/info`), (snapshot) => {
            const info = snapshot.val(); if(!info) return;
            if(info.status === "playing" && !isGameStarted) {
                isGameStarted = true;
                document.getElementById('gameStatusAlert').innerText = "⚔️ 실시간 대결 진행 중! ⚔️";
                document.getElementById('gameStatusAlert').style.color = "crimson";
                document.getElementById('btn1').disabled = document.getElementById('btn10').disabled = false;
                document.getElementById('multiNoticeOverlay').style.display = 'none';
            }
        });
        onValue(ref(rdb, `rooms/${roomId}/users`), (snapshot) => {
            const users = snapshot.val(); const listContainer = document.getElementById('roomUserList');
            if(!listContainer || !users) return; listContainer.innerHTML = '';
            Object.keys(users).forEach(key => {
                const u = users[key]; const item = document.createElement('div');
                item.className = 'room-user-item';
                item.innerHTML = `<span>👤 ${u.name} <b style="color:var(--gold)">[${u.constLevel}]</b></span><span>${u.pulls}뽑 <b style="color:var(--blue)">(${u.pity5}스택)</b></span>`;
                listContainer.appendChild(item);
            });
        });
    }

    function startGame() { if(isHost && currentRoomId) update(ref(rdb, `rooms/${currentRoomId}/info`), { status: "playing" }); }
    function getConstLabel() { return globalStats.pickupCount === -1 ? "미보유" : (globalStats.pickupCount >= 6 ? "풀돌" : "C"+globalStats.pickupCount); }
    function syncMultiplayerStatus() { if (!isMultiplayerMode || !currentRoomId) return; update(ref(rdb, `rooms/${currentRoomId}/users/${myName}`), { name: myName, pulls: globalStats.totalPulls, constLevel: getConstLabel(), pity5: globalStats.pity5, lastUpdate: Date.now() }); }

    function playC6Cutscene() {
        const overlay = document.getElementById('c6Cutscene');
        overlay.style.display = 'flex'; setTimeout(() => overlay.style.opacity = '1', 50);
        for(let i=1; i<=6; i++) {
            setTimeout(() => {
                document.getElementById(`star${i}`).classList.add('active');
                document.getElementById(`line${i}`).classList.add('draw');
            }, i * 650);
        }
        setTimeout(() => { document.getElementById('c6Title').style.opacity = '1'; document.getElementById('c6Title').style.transform = 'translateY(0)'; document.getElementById('c6Title').style.transition = 'all 0.8s ease'; }, 4200);
        setTimeout(() => { document.getElementById('c6Subtitle').style.opacity = '1'; document.getElementById('c6CloseBtn').style.opacity = '1'; }, 4800);
    }
    function closeC6Cutscene() { const overlay = document.getElementById('c6Cutscene'); overlay.style.opacity = '0'; setTimeout(() => overlay.style.display = 'none', 800); }

    function handleWish(count) {
        const stage = document.getElementById('stage'), effectLayer = document.getElementById('effect-layer');
        const btn1 = document.getElementById('btn1'), btn10 = document.getElementById('btn10');
        const placeholder = document.getElementById('stage-placeholder');
        
        if(placeholder) placeholder.style.display = 'none';
        Array.from(stage.querySelectorAll('.card')).forEach(c => c.remove());
        effectLayer.innerHTML = ''; btn1.disabled = btn10.disabled = true;

        const results = Array.from({length: count}, calculateOne);
        const maxRank = Math.max(...results.map(r => r.rank));
        const hasRad = results.some(r => r.isRadiance);

        const star = document.createElement('div');
        star.className = `shooting-star ${hasRad ? 'star-rad' : 'star-'+maxRank}`;
        effectLayer.appendChild(star);
        if (maxRank >= 4) {
            setTimeout(() => {
                stage.classList.add('stage-dimmed');
                const wave = document.createElement('div');
                wave.className = `shockwave-impact ${hasRad ? 'wave-rad' : (maxRank === 5 ? 'wave-5' : 'wave-4')}`;
                stage.appendChild(wave);
                setTimeout(() => { wave.remove(); stage.classList.remove('stage-dimmed'); }, 1200);
            }, 1500);
        }

        if (maxRank === 4) setTimeout(() => triggerFlash('#bf40ff', 0.4), 1400);
        else if (maxRank === 5 || hasRad) setTimeout(() => triggerFlash('#ffffff', 0.8), 1650);
        const animTimes = { 'star-3': 2000, 'star-4': 3500, 'star-5': 4200, 'star-rad': 5500 };
        setTimeout(() => showCards(results, count), (hasRad ? animTimes['star-rad'] : animTimes['star-'+maxRank]) + 100);
    }

    function triggerFlash(color, opacity) {
        const flash = document.getElementById('flashOverlay');
        if(!flash) return;
        flash.style.background = color; flash.style.opacity = opacity; flash.style.transition = 'none';
        setTimeout(() => { flash.style.transition = 'opacity 0.6s ease-out'; flash.style.opacity = 0; }, 50);
    }

    function calculateOne() {
        let res = { rank: 3, name: "3성 무기", isRadiance: false, stack: 0, isPickup: false, constLevel: "" };
        let chance = 0.6 + (globalStats.pity5 >= 74 ? (globalStats.pity5 - 73) * 6 : 0);
        globalStats.pity5++; globalStats.totalPulls++; globalStats.pity4++;
        if (Math.random() * 100 < chance || globalStats.pity5 >= 90) {
            res.rank = 5;
            res.stack = globalStats.pity5;
            let win = false;
            if (globalStats.isGuaranteed) { win = true; globalStats.isGuaranteed = false; }
            else {
                let radChance = (globalStats.radianceStack === 0) ? 5 : (globalStats.radianceStack === 1 ? 10 : 100);
                if (Math.random() * 100 < 50) win = true;
                else if (Math.random() * 100 < radChance) { win = true; res.isRadiance = true; }
                else { win = false; globalStats.isGuaranteed = true; globalStats.radianceStack++; }
            }
            res.isPickup = win;
            if (win) { globalStats.pickupCount++; res.constLevel = globalStats.pickupCount >= 6 ? "풀돌" : "C" + globalStats.pickupCount; }
            res.name = win ? (res.isRadiance ? "별빛포착!" : "픽업 캐릭터") : "상시 캐릭터";
            globalStats.pity5 = 0;
            
            savedArchive.push({
                name: res.name,
                rank: res.rank,
                isRadiance: res.isRadiance,
                isPickup: res.isPickup,
                stack: res.stack,
                timestamp: Date.now()
            });
        } else if (Math.random() * 100 < 5.1 || globalStats.pity4 >= 10) {
            res.rank = 4;
            res.name = "4성 캐릭터"; globalStats.pity4 = 0;
        }
        return res;
    }

    function showCards(results, count) {
        const stage = document.getElementById('stage');
        if(!stage) return;
        document.getElementById('btnSkip').style.display = 'block';
        results.forEach((res, i) => {
            const card = document.createElement('div'); card.className = `card`;
            if(count === 1) card.style.maxWidth = "200px";
            card.innerHTML = `<div class="card-inner">
                <div class="card-back" onclick="flipCard(this, ${JSON.stringify(res).replace(/"/g, '&quot;')})"></div>
                <div class="card-front res-${res.isRadiance ? 'rad' : res.rank}">
                    <div style="font-size:0.6em;">${'✦'.repeat(res.rank)}</div>
                    <div>${res.name}</div>
                    ${res.isPickup ? `<div style="font-size:0.7em; margin-top:5px; color:#d32f2f; background:rgba(0,0,0,0.1); border-radius:10px; padding:2px 5px; display:inline-block;">${res.constLevel}</div>` : ''}
                </div>
            </div>`;
            stage.appendChild(card);
            setTimeout(() => card.classList.add('active'), i * 30);
        });
    }

    function flipCard(el, res) {
        const card = el.closest('.card');
        if(!card || card.classList.contains('flipped')) return;
        card.classList.add('flipped');
        
        if(res.rank === 5) { globalStats.results5.push(res); updateHistory(res); }
        
        syncUI();
        syncMultiplayerStatus();
        checkAndUploadC6();
        checkDone();
    }

    function syncUI() {
        const totalWon = globalStats.totalPulls * COST_PER_PULL;
        document.getElementById('dispPity').innerText = globalStats.pity5;
        document.getElementById('dispGuaranteed').innerText = globalStats.isGuaranteed ? "확정권" : "반천장";
        document.getElementById('dispGems').innerText = (globalStats.totalPulls * 160).toLocaleString();
        document.getElementById('dispWon').innerText = "₩ " + totalWon.toLocaleString();
        document.getElementById('dispChicken').innerText = (totalWon / CHICKEN_PRICE).toFixed(1) + " 마리";
        document.getElementById('dispConst').innerText = getConstLabel();
        if(globalStats.results5.length > 0) {
            const avg = globalStats.results5.reduce((a, b) => a + b.stack, 0) / globalStats.results5.length;
            document.getElementById('anaAvg').innerText = avg.toFixed(1);
        } else {
            document.getElementById('anaAvg').innerText = "0";
        }
    }

    function updateHistory(res) {
        const list = document.getElementById('historyList');
        if(!list) return;
        const item = document.createElement('div'); item.style.padding = "5px 0"; item.style.borderBottom = "1px solid #1f2736";
        const color = res.isRadiance ? 'var(--radiance)' : (res.isPickup ? 'var(--gold)' : '#888');
        item.innerHTML = `<span style="color:${color}">${res.name}${res.isPickup ? ' ['+res.constLevel+']' : ''}</span> <span style="float:right; color:#666;">${res.stack}스택</span>`;
        list.prepend(item);
    }

    function revealAll() { document.querySelectorAll('.card:not(.flipped) .card-back').forEach((c, i) => setTimeout(() => c.click(), i * 35)); }
    function checkDone() {
        const total = document.querySelectorAll('.card').length, flipped = document.querySelectorAll('.card.flipped').length;
        if (total > 0 && total === flipped) {
            document.getElementById('btnSkip').style.display = 'none';
            if(isGameStarted) { document.getElementById('btn1').disabled = document.getElementById('btn10').disabled = false; }
        }
    }
</script>
