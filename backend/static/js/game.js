let gameState = {
    sessionId: null, topic: null, monster: null, bossData: null,
    monsterHp: 100, monsterMaxHp: 100, playerHp: 3, playerMaxHp: 3,
    level: 1, phase: 1, questions: [], currentQuestionIndex: 0,
    score: 0, totalAnswered: 0, combo: 0, maxCombo: 0,
    isAnimating: false, startTime: null,
    askedQuestionHashes: new Set(), askedConcepts: new Set(),
    roundHistory: [], questionTimer: null,
    timePerQuestion: 30, timerEnabled: true,
    fetchAttempts: 0, maxFetchAttempts: 5,
    battleOver: false, _battleRewards: null,
    roundAnswered: 0, roundCorrect: 0, roundMaxCombo: 0,
    // ── Combat mechanics ──
    comboShield: false, powerCards: [], correctSinceLastCard: 0,
    recentAccuracy: [], questionStartTime: null,
    // ── Ghost replay ──
    ghostData: null, currentRunLog: [],
    // ── Coverage map ──
    conceptsCovered: {},
    // ── Misc ──
    _bgFetching: false, _lastStandShown: false,
    coins: 0, hintCharges: 0, fiftyFiftyCharges: 0, _healCount: 0,
};

// ============================================
// DIFFICULTY THEME
// ============================================
function applyDifficultyTheme(difficulty) {
    const themes = {
        easy:      { primary:'#22cc44', bg:'linear-gradient(135deg,#001a00,#0a1a0a)', border:'#22cc4444', accent:'#00ff44', hpBar:'linear-gradient(to right,#22cc44,#44ff66)' },
        medium:    { primary:'#ee8800', bg:'linear-gradient(135deg,#1a0e00,#0d0a00)', border:'#ee880044', accent:'#ffaa00', hpBar:'linear-gradient(to right,#ee8800,#ffaa00)' },
        hard:      { primary:'#cc2244', bg:'linear-gradient(135deg,#1a0000,#0d000d)', border:'#cc224444', accent:'#ff3355', hpBar:'linear-gradient(to right,#cc2244,#ff3366)' },
        nightmare: { primary:'#ff0000', bg:'linear-gradient(135deg,#080000,#110000)', border:'#ff000044', accent:'#ff0000', hpBar:'linear-gradient(to right,#880000,#ff0000)', nightmareEffects:true },
    };
    const theme = themes[difficulty] || themes.hard;
    document.body.style.background = theme.bg;
    const existing = document.getElementById('difficulty-theme');
    if (existing) existing.remove();
    const styleEl = document.createElement('style');
    styleEl.id = 'difficulty-theme';
    styleEl.textContent = `
        :root { --diff-primary:${theme.primary}; --diff-border:${theme.border}; --diff-accent:${theme.accent}; }
        #monster-name { color:${theme.accent}!important; }
        #monster-hp-fill { background:${theme.hpBar}!important; }
        #player-level { color:${theme.primary}!important; }
        .choice-btn:hover { border-color:${theme.primary}!important; box-shadow:0 4px 12px ${theme.border}!important; }
        #dialogue-speaker { color:${theme.accent}!important; }
        #text-submit-btn { background:${theme.hpBar}!important; border-color:${theme.primary}!important; }
        #text-answer-input:focus { border-color:${theme.primary}!important; }
        .action-btn { background:${theme.hpBar}!important; border-color:${theme.primary}!important; }
        ${theme.nightmareEffects ? `#monster-name { text-shadow:0 0 20px #ff0000,0 0 40px #880000!important; } #player-name { color:#ff3333!important; }` : ''}
    `;
    document.head.appendChild(styleEl);
    const playerInfo = document.getElementById('player-info');
    if (playerInfo && !document.getElementById('diff-badge')) {
        const badge = document.createElement('div');
        badge.id = 'diff-badge';
        const labels = { easy:'😄 EASY', medium:'🙂 MEDIUM', hard:'😐 HARD', nightmare:'☠ NIGHTMARE' };
        badge.style.cssText = `font-size:10px;margin-top:6px;color:${theme.primary};letter-spacing:1px;`;
        badge.textContent = labels[difficulty] || difficulty.toUpperCase();
        playerInfo.appendChild(badge);
    }
}

const BACKEND_URL = (function() {
    const p = new URLSearchParams(window.location.search).get('backend_url');
    if (p) return decodeURIComponent(p);
    return window.BACKEND_URL || 'http://localhost:8000';
})();

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    gameState.sessionId   = params.get('session');
    gameState.topic       = decodeURIComponent(params.get('topic') || '');
    gameState.level       = parseInt(params.get('level') || '1');
    gameState.userId      = params.get('user');
    gameState.difficulty  = params.get('difficulty') || 'hard';
    gameState.username    = params.get('username') || '';
    gameState.playerTitle = params.get('title') || '';
    gameState.coins       = parseInt(params.get('coins') || '0');

    const diffHearts = { easy:5, medium:4, hard:3, nightmare:1 };
    gameState.playerMaxHp = diffHearts[gameState.difficulty] || 3;
    gameState.playerHp    = gameState.playerMaxHp;
    gameState.timePerQuestion = Math.max(15, 30 - gameState.level * 2);

    applyDifficultyTheme(gameState.difficulty);
    const nameEl  = document.getElementById('player-name');
    const labelEl = document.getElementById('player-label');
    if (nameEl  && gameState.username)    nameEl.textContent  = gameState.username.toLowerCase();
    if (labelEl && gameState.playerTitle) labelEl.textContent = gameState.playerTitle.toUpperCase();
    renderPlayerHearts();
    await initializeBattle();
});

function renderPlayerHearts() {
    const c = document.getElementById('player-hearts');
    c.innerHTML = '';
    for (let i = 0; i < gameState.playerMaxHp; i++) {
        const h = document.createElement('div');
        h.className = 'heart';
        c.appendChild(h);
    }
}

const gameStateBackup = {};
function saveProgress() {
    gameStateBackup[`battle_${gameState.sessionId}`] = {
        monsterHp:gameState.monsterHp, playerHp:gameState.playerHp,
        currentQuestionIndex:gameState.currentQuestionIndex, phase:gameState.phase,
        combo:gameState.combo, maxCombo:gameState.maxCombo,
        score:gameState.score, totalAnswered:gameState.totalAnswered, timestamp:Date.now()
    };
}
function clearProgress() { delete gameStateBackup[`battle_${gameState.sessionId}`]; }

// ============================================
// INITIALIZE BATTLE
// ============================================
async function initializeBattle() {
    try {
        updateLoadingText('Loading battle...');
        let bossData = null, prefetchedPhase1 = [], prefetchedPhase2 = [];

        // Try localStorage first (zero network)
        try {
            const lsRaw = localStorage.getItem('cmai_active_boss');
            if (lsRaw) {
                const p = JSON.parse(lsRaw);
                if (p.sessionId === gameState.sessionId) {
                    bossData = p.bossData || p;
                    prefetchedPhase1 = p.prefetchedPhase1 || [];
                    prefetchedPhase2 = p.prefetchedPhase2 || [];
                    if (p.coins && !gameState.coins) gameState.coins = p.coins;
                }
            }
        } catch(e) {}

        // Server-side prefetch cache
        if (!bossData) {
            try {
                updateLoadingText('Preparing battle arena...');
                const r = await fetch(`${BACKEND_URL}/arena/prefetch?session_id=${gameState.sessionId}`, { credentials:'include' });
                if (r.ok) {
                    const c = await r.json();
                    if (c.ok && c.bossData) { bossData = c.bossData; prefetchedPhase1 = c.prefetchedPhase1||[]; prefetchedPhase2 = c.prefetchedPhase2||[]; }
                }
            } catch(e) {}
        }

        // Full boss summon fallback
        if (!bossData) {
            updateLoadingText('Summoning boss from the depths of knowledge...');
            const r = await fetch(`${BACKEND_URL}/arena/boss?topic=${encodeURIComponent(gameState.topic)}&session_id=${gameState.sessionId}`, { method:'POST', credentials:'include' });
            if (!r.ok) throw new Error('Failed to summon boss');
            bossData = await r.json();
        }

        gameState.bossData = bossData;
        gameState._prefetchedPhase2 = prefetchedPhase2;
        gameState.monster = selectMonster(gameState.topic);
        gameState.monster.name  = bossData.name  || gameState.monster.name;
        gameState.monster.title = bossData.title || gameState.monster.title;
        if (bossData.hit_taunts?.length)    gameState.monster.taunts.hit    = bossData.hit_taunts;
        if (bossData.miss_taunts?.length)   gameState.monster.taunts.miss   = bossData.miss_taunts;
        if (bossData.phase2_taunts?.length) gameState.monster.taunts.phase2 = bossData.phase2_taunts;
        if (bossData.defeat_taunt)          gameState.monster.taunts.defeat = bossData.defeat_taunt;
        if (bossData.intro_taunt)           gameState.monster.taunts.intro  = bossData.intro_taunt;

        gameState.monsterMaxHp = (bossData.max_hp || 100) + (gameState.level * 20);
        gameState.monsterHp    = gameState.monsterMaxHp;
        // Seed hint charges from equipped items (e.g. Study Headphones, Silver Crown, etc.)
        if (bossData.equipment_arena_hints) {
            gameState.hintCharges = (gameState.hintCharges || 0) + bossData.equipment_arena_hints;
        }

        document.getElementById('monster-name').textContent       = gameState.monster.name;
        document.getElementById('monster-title').textContent      = gameState.monster.title;
        document.getElementById('monster-hp-max').textContent     = gameState.monsterMaxHp;
        document.getElementById('monster-hp-current').textContent = gameState.monsterHp;
        document.getElementById('level-number').textContent       = gameState.level;
        document.getElementById('monster-container').innerHTML    = gameState.monster.sprite;
        if (typeof initDragonSprite === 'function') initDragonSprite();

        if (bossData.special_ability) {
            document.getElementById('combat-hint').textContent = `Boss Special: ${bossData.special_ability}`;
        }

        // Personal best + ghost
        const pb = loadPersonalBest(gameState.topic, gameState.difficulty);
        if (pb) renderPersonalBest(pb);
        const ghost = loadGhostRun(gameState.topic, gameState.difficulty);
        if (ghost) { gameState.ghostData = ghost; }

        hideLoadingScreen();
        if (ghost) initGhostBar();

        const introTaunt = bossData.intro_taunt || getRandomTaunt(gameState.monster, 'intro');
        await showDialogue(gameState.monster.name.toUpperCase(), introTaunt, true);

        if (prefetchedPhase1.length > 0) {
            prefetchedPhase1.forEach(q => { if (q.concept) gameState.askedConcepts.add(q.concept); });
            gameState.questions.push(...prefetchedPhase1);
        } else {
            await fetchQuestions('normal', 1);
        }

        gameState.startTime = Date.now();
        updatePlayerHearts();
        // FIX: Fetch both /shop (for consumable inventory) and /hud (for active buffs)
        // so potions and hint scrolls show correctly from round 1.
        try {
            const [shopRes, hudRes] = await Promise.all([
                fetch(`${BACKEND_URL}/shop`, { credentials: 'include' }),
                fetch(`${BACKEND_URL}/hud`,  { credentials: 'include' }),
            ]);
            // Populate consumable inventory from shop
            if (shopRes.ok) {
                const shopData = await shopRes.json();
                if (shopData.coins !== undefined) gameState.coins = shopData.coins;
                gameState._shopInventory = {};
                (shopData.items || []).forEach(item => {
                    if (item.consumable) gameState._shopInventory[item.id] = item.quantity || 0;
                });
            }
            // Compute final totals from BOTH inventory + buff charges
            // These are the single source of truth during the entire battle
            if (hudRes.ok) {
                const h = await hudRes.json();
                const healBuff  = h.buffs && h.buffs.heal_1      ? (parseInt(h.buffs.heal_1.count)      || 0) : 0;
                const fiftyBuff = h.buffs && h.buffs.fifty_fifty ? (parseInt(h.buffs.fifty_fifty.count) || 0) : 0;
                const healInv   = gameState._shopInventory?.['potion_health_small'] || 0;
                const fiftyInv  = gameState._shopInventory?.['fifty_fifty']         || 0;
                // _totalHealCount / _totalFiftyCount = the ONE number we track & decrement
                gameState._totalHealCount  = healInv  + healBuff;
                gameState._totalFiftyCount = fiftyInv + fiftyBuff;
                // Legacy aliases (still read in a few places — keep in sync)
                gameState._pendingHeal      = gameState._totalHealCount;
                gameState._healCount        = gameState._totalHealCount;
                gameState.fiftyFiftyCharges = gameState._totalFiftyCount;
                // Zero out shopInventory charges so we don't double-count during battle
                if (gameState._shopInventory) {
                    gameState._shopInventory['potion_health_small'] = 0;
                    gameState._shopInventory['fifty_fifty']          = 0;
                }
            }
            updateConsumableBar();
        } catch(e) {}
        await startCombat();

    } catch(error) {
        document.getElementById('loading-text').textContent = `Error: ${error.message}`;
        setTimeout(() => { if (confirm('Failed to initialize battle. Retry?')) location.reload(); else returnToStreamlit(); }, 2000);
    }
}

// ============================================
// QUESTION FETCHING
// ============================================
async function fetchQuestions(difficulty = 'normal', phase = 1) {
    // Adaptive difficulty
    if (gameState.recentAccuracy.length >= 5) {
        const rollingAcc = gameState.recentAccuracy.slice(-5).filter(Boolean).length / 5;
        if (rollingAcc >= 0.8 && difficulty !== 'hard') difficulty = 'hard';
        else if (rollingAcc <= 0.4 && difficulty === 'hard') difficulty = 'normal';
    }
    gameState.fetchAttempts++;
    const r = await fetch(
        `${BACKEND_URL}/arena/quiz?topic=${encodeURIComponent(gameState.topic)}&session_id=${gameState.sessionId}&difficulty=${difficulty}&num_questions=5&phase=${phase}&asked_concepts=${encodeURIComponent(Array.from(gameState.askedConcepts).join(','))}`,
        { method:'POST', credentials:'include' }
    );
    if (!r.ok) throw new Error('Failed to fetch questions');
    const data = await r.json();
    const newQs = data.questions || [];
    newQs.forEach(q => { if (q.concept) gameState.askedConcepts.add(q.concept); });
    gameState.questions.push(...newQs);
    return newQs.length;
}

// ============================================
// COMBAT LOOP
// ============================================
async function startCombat() { await displayQuestion(); }

async function displayQuestion() {
    if (gameState.battleOver) return;
    if (gameState.monsterHp <= 0) { await handleVictory(); return; }
    if (gameState.playerHp  <= 0) { await handleDefeat(); if (gameState.battleOver) return; }

    while (gameState.currentQuestionIndex < gameState.questions.length) {
        const q = gameState.questions[gameState.currentQuestionIndex];
        const qHash = q.question.toLowerCase().trim();
        if (gameState.askedQuestionHashes.has(qHash)) { gameState.currentQuestionIndex++; continue; }
        gameState.askedQuestionHashes.add(qHash);
        gameState.questionStartTime = Date.now();

        await showDialogue(gameState.monster.name.toUpperCase(), q.question, false);
        document.getElementById('combat-section').classList.remove('hidden');
        document.getElementById('question-text').textContent = q.question;
        // Re-clamp boss canvas now that battle-bottom has expanded to show the question panel
        if (typeof window.reclampBossCanvas === 'function') window.reclampBossCanvas();
        updateCombatHint(q);
        enableInputs();
        if (q.options?.length > 0) showMCQOptions(q);
        else showTextInput(q);
        if (gameState.timerEnabled && gameState.timePerQuestion > 0) startQuestionTimer(q);

        // Background fetch when pool runs low
        const remaining = gameState.questions.length - gameState.currentQuestionIndex - 1;
        if (remaining <= 3 && gameState.fetchAttempts < gameState.maxFetchAttempts && !gameState._bgFetching) {
            gameState._bgFetching = true;
            fetchQuestions(gameState.phase === 2 ? 'hard' : 'normal', gameState.phase).then(() => { gameState._bgFetching = false; }).catch(() => { gameState._bgFetching = false; });
        }
        return;
    }

    if (gameState.fetchAttempts >= gameState.maxFetchAttempts) {
        if (gameState.monsterHp <= gameState.monsterMaxHp * 0.25) { gameState.monsterHp = 0; updateMonsterHP(); await handleVictory(); }
        else await handleStalemate();
        return;
    }
    try {
        const n = await fetchQuestions(gameState.phase === 2 ? 'hard' : 'normal', gameState.phase);
        if (n === 0) {
            if (gameState.monsterHp <= gameState.monsterMaxHp * 0.25) { gameState.monsterHp = 0; updateMonsterHP(); await handleVictory(); }
            else await handleStalemate();
            return;
        }
        await displayQuestion();
    } catch(e) {
        if (gameState.monsterHp <= gameState.monsterMaxHp * 0.5) { gameState.monsterHp = 0; updateMonsterHP(); await handleVictory(); }
        else await handleStalemate();
    }
}

function updateCombatHint(q) {
    const hintEl = document.getElementById('combat-hint');
    // FIX: Show the USER's chosen difficulty (gameState.difficulty), not the adaptive question difficulty
    const diffColors = { easy:'🟢', medium:'🟡', hard:'🔴', nightmare:'☠' };
    const diff = gameState.difficulty || 'hard';  // was: q.difficulty — wrong, showed question's adaptive difficulty
    const baseDmg   = 15 + (gameState.level * 3);
    const comboDmg  = Math.min(gameState.combo * 3, 25);
    const diffBonus = q.difficulty === 'hard' ? 10 : q.difficulty === 'medium' ? 5 : 0;
    const dmgPct    = Math.round(((baseDmg + comboDmg + diffBonus) / gameState.monsterMaxHp) * 100);
    let h = `${diffColors[diff]||'🔴'} ${diff.toUpperCase()}`;
    if (gameState.combo > 0) h += ` | 🔥 ${gameState.combo}x`;
    h += ` | ⚔ <span style="color:#f5d27a">~${dmgPct}% HP</span>`;
    if (checkWeakness(q)) h += ` <span style="color:#ffe000;background:rgba(255,200,0,0.1);border:1px solid rgba(255,200,0,0.3);padding:1px 5px;font-size:10px;">⚡ WEAKNESS 2×</span>`;
    if (gameState.comboShield) h += ` <span style="color:#88ccff;background:rgba(100,160,255,0.1);border:1px solid rgba(100,160,255,0.3);padding:1px 5px;font-size:10px;">🛡 SHIELD</span>`;
    hintEl.innerHTML = h;
}

// ============================================
// ANSWER HANDLING
// ============================================
async function handleAnswer(userAnswer, correctAnswer, question) {
    if (gameState.isAnimating || gameState.battleOver) return;
    gameState.isAnimating = true;
    clearQuestionTimer();
    disableInputs();
    document.getElementById('combat-section').classList.add('hidden');

    const isTimeout = userAnswer === '__TIMEOUT__';
    const isCorrect = isTimeout ? false : checkAnswer(userAnswer, correctAnswer);
    gameState.totalAnswered++;

    // Rolling accuracy (5-window adaptive difficulty)
    gameState.recentAccuracy.push(isCorrect);
    if (gameState.recentAccuracy.length > 5) gameState.recentAccuracy.shift();

    // Ghost replay snapshot
    gameState.currentRunLog.push({ q: gameState.totalAnswered, bossHp: gameState.monsterHp, correct: isCorrect });

    // Concept coverage
    const concept = question.concept || 'general';
    if (!gameState.conceptsCovered[concept]) gameState.conceptsCovered[concept] = { total:0, correct:0 };
    gameState.conceptsCovered[concept].total++;
    if (isCorrect) gameState.conceptsCovered[concept].correct++;
    updateCoverageMap();

    gameState.roundHistory.push({ question:question.question, userAnswer: isTimeout?'(timed out)':userAnswer, correctAnswer, correct:isCorrect, concept, difficulty:question.difficulty||'medium', explanation:question.explanation||'', hint:question.hint||'', timestamp:Date.now() });

    if (isCorrect) await handleCorrectAnswer(question);
    else           await handleWrongAnswer(question, correctAnswer, isTimeout);

    gameState.currentQuestionIndex++;
    saveProgress();
    gameState.isAnimating = false;

    // Fire-and-forget round rewards
    if (gameState.userId && gameState.roundAnswered >= 5) {
        fetch(`${BACKEND_URL}/rewards/award`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user_id:gameState.userId, action_type:'arena_round_complete', accuracy:gameState.roundCorrect/5, difficulty:gameState.phase===2?1.5:1.2, combo_count:gameState.roundMaxCombo||1 }) }).catch(()=>{});
        gameState.roundAnswered = 0; gameState.roundCorrect = 0; gameState.roundMaxCombo = 0;
    }

    if (gameState.monsterHp <= 0) { await handleVictory(); return; }
    if (gameState.playerHp  <= 0) {
        await handleDefeat();
        // If battleOver is still false, the player was rescued by a potion —
        // reset HP indicator and continue the battle.
        if (gameState.battleOver) return;
        // Fall through to displayQuestion below
    }
    const hpPct = gameState.monsterHp / gameState.monsterMaxHp;
    if (hpPct <= 0.5 && gameState.phase === 1) { await triggerPhase2(); return; }
    await displayQuestion();
}

async function handleCorrectAnswer(question) {
    gameState.score++;
    gameState.combo++;
    gameState.maxCombo = Math.max(gameState.maxCombo, gameState.combo);
    gameState.roundAnswered++;
    gameState.roundCorrect++;
    gameState.roundMaxCombo = Math.max(gameState.roundMaxCombo, gameState.combo);
    gameState.correctSinceLastCard++;

    const baseDamage  = 15 + (gameState.level * 3);
    const comboDamage = Math.min(gameState.combo * 3, 25);
    const diffBonus   = question.difficulty === 'hard' ? 10 : question.difficulty === 'medium' ? 5 : 0;
    let   totalDamage = baseDamage + comboDamage + diffBonus;
    let   damageNote  = '';

    // Speed bonus: answered within 5 seconds
    const responseTime = gameState.questionStartTime ? (Date.now() - gameState.questionStartTime) : 9999;
    if (responseTime < 5000) { totalDamage += 5; damageNote += ' ⚡+5'; }

    // Weakness exploitation: 2x damage
    if (checkWeakness(question)) { totalDamage *= 2; damageNote += ' ⚡2×'; }

    // Critical hit: 10% chance
    const isCrit = Math.random() < 0.10;
    if (isCrit) { totalDamage = Math.round(totalDamage * 2); damageNote += ' 💥CRIT!'; }

    gameState.monsterHp = Math.max(0, gameState.monsterHp - totalDamage);

    if (isCrit) flashScreen('white');
    else        flashScreen('green');
    triggerMonsterHit();
    showDamageNumber(totalDamage, isCrit);
    updateMonsterHP();
    updateGhostBar();
    updateStreakBadge(gameState.combo);

    // Combo shield at every 5-combo
    if (gameState.combo > 0 && gameState.combo % 5 === 0 && !gameState.comboShield) {
        gameState.comboShield = true;
        updateComboShieldUI(true);
        showFloatingMessage('🛡 COMBO SHIELD!', '#88ccff');
    }

    // Power card every 7 correct
    if (gameState.correctSinceLastCard >= 7) {
        gameState.correctSinceLastCard = 0;
        await drawPowerCard();
    }

    let msg = `⚔️ CORRECT! -${totalDamage} HP!${damageNote}`;
    if (gameState.combo > 1) msg += ` 🔥${gameState.combo}x`;
    await showDialogue('SCHOLAR', msg, false);
    await showDialogue(gameState.monster.name.toUpperCase(), getRandomTaunt(gameState.monster, 'hit'), false);
}

async function handleWrongAnswer(question, correctAnswer, isTimeout) {
    gameState.roundAnswered++;
    gameState.roundMaxCombo = Math.max(gameState.roundMaxCombo, gameState.combo);

    // Combo shield absorbs one wrong answer
    if (gameState.comboShield && !isTimeout) {
        gameState.comboShield = false;
        updateComboShieldUI(false);
        gameState.combo = 0;
        updateStreakBadge(0);
        shatterStreakBadge();
        showFloatingMessage('🛡 Shield absorbed the hit!', '#88ccff');
        await showDialogue(gameState.monster.name.toUpperCase(), getRandomTaunt(gameState.monster, 'miss'), false);
        return;
    }

    gameState.combo = 0;
    gameState.playerHp = Math.max(0, gameState.playerHp - 1);
    shatterStreakBadge();
    flashScreen('red');
    shakeScreen();
    loseHeart();
    // Delay updatePlayerHearts so the shatter animation (0.65s) plays fully
    // before hearts are snapped to their final state. Without this delay,
    // updatePlayerHearts() immediately set .empty on the animating heart,
    // making it look like 2 hearts disappeared at once visually.
    setTimeout(() => updatePlayerHearts(), 700);
    updateGhostBar();

    if (isTimeout) await showDialogue('⏰', "TIME'S UP! The boss strikes!", false);
    await showDialogue(gameState.monster.name.toUpperCase(), getRandomTaunt(gameState.monster, 'miss'), false);
}

function checkAnswer(userAnswer, correctAnswer) {
    const norm = s => s.toLowerCase().trim().replace(/[^\w\s]/g, '');
    const u = norm(userAnswer), c = norm(correctAnswer);
    if (u === c) return true;
    const ul = u.charAt(0), cl = c.charAt(0);
    if (ul === cl && 'abcd'.includes(cl) && c.length <= 2) return true;
    if (u.includes(c) || c.includes(u)) return true;
    return false;
}

// ============================================
// PHASE 2 TRANSITION
// ============================================
async function triggerPhase2() {
    if (gameState.phase === 2) return;
    gameState.phase = 2;
    for (let i = 0; i < 3; i++) { shakeScreen(); await sleep(300); }
    const impossibleLine = gameState.bossData?.phase2_taunts?.[1] || 'Impossible!! Now I will show you what a true monster is!';
    await showDialogue(gameState.monster.name.toUpperCase(), impossibleLine, true);

    // PHASE 2 SHOP
    await showPhase2Shop();

    showLoadingScreen();
    updateLoadingText('⚠️ Boss is ENRAGED! Harder questions incoming...');
    const p2 = gameState._prefetchedPhase2 || [];
    if (p2.length > 0) {
        p2.forEach(q => { if (q.concept) gameState.askedConcepts.add(q.concept); });
        gameState.questions.push(...p2); gameState._prefetchedPhase2 = [];
    } else {
        try { await fetchQuestions('hard', 2); } catch(e) {}
    }
    await sleep(800);
    hideLoadingScreen();
    document.getElementById('phase-indicator').classList.remove('hidden');
    // Call directly — the MutationObserver in arena.html may already have fired
    // or the timing window may be missed; belt-and-suspenders ensures the boss
    // always redraws at the larger phase-2 size when entering phase 2.
    if (typeof redrawBossPhase2 === 'function') redrawBossPhase2();
    const phase2Taunt = gameState.bossData?.phase2_taunts?.[0] || getRandomTaunt(gameState.monster, 'phase2') || 'ENOUGH! NOW YOU FACE MY TRUE POWER!';
    await showDialogue(gameState.monster.name.toUpperCase(), phase2Taunt, true);
    await displayQuestion();
}

// ============================================
// END GAME: VICTORY
// ============================================
async function handleVictory() {
    if (gameState.battleOver) return;
    gameState.battleOver = true;
    clearQuestionTimer();
    try { localStorage.removeItem('cmai_active_boss'); } catch(e) {}

    const endTime   = Date.now();
    const timeTaken = Math.floor((endTime - (gameState.startTime || endTime)) / 1000);
    const accuracy  = gameState.totalAnswered > 0 ? Math.round((gameState.score / gameState.totalAnswered) * 100) : 0;

    let grade, gradeColor;
    if (accuracy >= 95)      { grade='S+'; gradeColor='#FFD700'; }
    else if (accuracy >= 90) { grade='S';  gradeColor='#FFD700'; }
    else if (accuracy >= 80) { grade='A';  gradeColor='#00ff00'; }
    else if (accuracy >= 70) { grade='B';  gradeColor='#4444ff'; }
    else if (accuracy >= 60) { grade='C';  gradeColor='#ffaa00'; }
    else if (accuracy >= 50) { grade='D';  gradeColor='#ff8800'; }
    else                     { grade='F';  gradeColor='#ff3333'; }

    clearProgress();

    // Save personal best + ghost
    const pb = loadPersonalBest(gameState.topic, gameState.difficulty);
    const isNewRecord = !pb || timeTaken < pb.time || accuracy > pb.accuracy;
    if (isNewRecord) savePersonalBest(gameState.topic, gameState.difficulty, timeTaken, accuracy, grade);
    saveGhostRun(gameState.topic, gameState.difficulty);

    // Submit daily leaderboard (fire-and-forget)
    if (gameState.userId) {
        fetch(`${BACKEND_URL}/arena/leaderboard`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user_id:gameState.userId, topic:gameState.topic, difficulty:gameState.difficulty, grade, accuracy, time:timeTaken, date:new Date().toISOString().slice(0,10) }) }).catch(()=>{});
    }

    const defeatTaunt = gameState.bossData?.defeat_taunt || gameState.monster.taunts?.defeat;
    await showDialogue(gameState.monster.name.toUpperCase(), defeatTaunt, true);
    await sleep(500);

    if (gameState.userId) {
        try {
            const res = await fetch(`${BACKEND_URL}/rewards/award`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user_id:gameState.userId, action_type:'boss_defeat', accuracy: gameState.totalAnswered>0?(gameState.score/gameState.totalAnswered):0, difficulty: gameState.difficulty==='nightmare'?2.5:gameState.difficulty==='hard'?1.8:gameState.difficulty==='medium'?1.5:1.2, combo_count:gameState.maxCombo||1 }) });
            if (res.ok) { const d = await res.json(); if (d.ok) gameState._battleRewards = d; }
        } catch(e) {}
    }

    const minutes = Math.floor(timeTaken/60), seconds = timeTaken%60;
    const timeStr  = `${minutes}m ${seconds}s`;
    const wrong    = gameState.totalAnswered - gameState.score;
    const heartsLost = gameState.playerMaxHp - gameState.playerHp;
    const gradeDesc = {'S+':'LEGENDARY — Flawless!','S':'OUTSTANDING!','A':'EXCELLENT!','B':'SOLID.','C':'AVERAGE.','D':'WEAK.','F':'FAILED.'};

    const isNightmareVictory = gameState.difficulty === 'nightmare';

    let html = `
    ${isNightmareVictory ? '<div style="text-align:center;padding:10px 0 6px;font-size:11px;letter-spacing:3px;font-family:monospace;color:#ff3333;text-shadow:0 0 10px #ff000088;">☠ NIGHTMARE CONQUERED ☠</div>' : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px;margin:0 0 10px;">
        <div style="grid-column:1/-1;background:${isNightmareVictory?'rgba(80,0,0,0.7)':'rgba(0,0,0,0.5)'};border:1px solid ${isNightmareVictory?'#ff000066':gradeColor+'44'};padding:14px 10px;text-align:center;${isNightmareVictory?'box-shadow:0 0 30px #ff000033;':''}">
            <div style="font-size:52px;color:${gradeColor};font-family:'Cinzel Decorative',serif;text-shadow:0 0 20px ${gradeColor}${isNightmareVictory?',0 0 60px #ff0000':''};line-height:1;">${grade}</div>
            <div style="font-size:11px;color:${gradeColor}99;margin-top:5px;font-family:'Cinzel',serif;">${isNightmareVictory?'⚠ '+gradeDesc[grade]:gradeDesc[grade]||''}</div>
        </div>
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.15);padding:10px;text-align:center;"><div style="font-size:9px;color:#8a7a60;font-family:'Cinzel',serif;margin-bottom:4px;">ACCURACY</div><div style="font-size:22px;color:#4444ff;font-family:'Cinzel Decorative',serif;">${accuracy}%</div></div>
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.15);padding:10px;text-align:center;"><div style="font-size:9px;color:#8a7a60;font-family:'Cinzel',serif;margin-bottom:4px;">MAX COMBO</div><div style="font-size:22px;color:#ff8800;font-family:'Cinzel Decorative',serif;">${gameState.maxCombo}✕</div></div>
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.15);padding:10px;text-align:center;"><div style="font-size:9px;color:#8a7a60;font-family:'Cinzel',serif;margin-bottom:4px;">CORRECT</div><div style="font-size:22px;color:#00cc44;font-family:'Cinzel Decorative',serif;">${gameState.score}</div></div>
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.15);padding:10px;text-align:center;"><div style="font-size:9px;color:#8a7a60;font-family:'Cinzel',serif;margin-bottom:4px;">WRONG</div><div style="font-size:22px;color:#cc2233;font-family:'Cinzel Decorative',serif;">${wrong}</div></div>
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.15);padding:10px;text-align:center;"><div style="font-size:9px;color:#8a7a60;font-family:'Cinzel',serif;margin-bottom:4px;">TIME</div><div style="font-size:18px;color:#c9a84c;font-family:'Cinzel Decorative',serif;">${timeStr}</div></div>
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(201,168,76,0.15);padding:10px;text-align:center;"><div style="font-size:9px;color:#8a7a60;font-family:'Cinzel',serif;margin-bottom:4px;">HEARTS LOST</div><div style="font-size:18px;color:#ff4444;font-family:'Cinzel Decorative',serif;">${heartsLost}💔</div></div>
    </div>`;

    if (isNewRecord) {
        html += `<div style="background:linear-gradient(90deg,rgba(255,200,0,0.1),rgba(255,200,0,0.05));border:1px solid rgba(255,200,0,0.4);padding:10px;margin-bottom:8px;text-align:center;font-family:'Cinzel',serif;color:#f5d27a;font-size:11px;">🏆 NEW PERSONAL BEST — ${accuracy}% in ${timeStr}</div>`;
    } else if (pb) {
        const pMins = Math.floor(pb.time/60), pSecs = pb.time%60;
        html += `<div style="background:rgba(0,0,0,0.3);border:1px solid rgba(100,100,100,0.2);padding:8px;margin-bottom:8px;text-align:center;font-family:'Cinzel',serif;color:#8a7a60;font-size:10px;">Best: ${pb.grade} · ${pb.accuracy}% · ${pMins}m${pSecs}s</div>`;
    }

    if (wrong > 0) {
        html += `<button onclick="toggleBattleReport()" id="report-toggle-btn" style="width:100%;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.25);color:#c9a84c;padding:10px;font-size:11px;font-family:'Press Start 2P',monospace;cursor:pointer;margin-top:4px;letter-spacing:1px;" onmouseover="this.style.background='rgba(201,168,76,0.16)'" onmouseout="this.style.background='rgba(201,168,76,0.08)'">📖 Review Mistakes (${wrong})</button>
        <div id="battle-report-detail" style="display:none;margin-top:8px;max-height:260px;overflow-y:auto;text-align:left;"></div>`;
    }

    document.getElementById('rewards-list').innerHTML = html;
    buildBattleReport();
    document.getElementById('victory-screen').classList.remove('hidden');
    createConfetti();
}

// ============================================
// POTION RESCUE PROMPT
// ============================================
function showPotionRescuePrompt(potionCount) {
    return new Promise(async (resolve) => {
        // Build a modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(4,2,8,0.92);display:flex;align-items:center;justify-content:center;z-index:20000;backdrop-filter:blur(4px);';

        const box = document.createElement('div');
        box.style.cssText = 'text-align:center;padding:32px 28px;max-width:400px;width:90%;border:1px solid rgba(201,168,76,0.35);background:linear-gradient(160deg,rgba(14,6,22,0.98),rgba(6,3,12,0.99));clip-path:polygon(0 0,calc(100% - 18px) 0,100% 18px,100% 100%,18px 100%,0 calc(100% - 18px));';

        const plural = potionCount > 1 ? 's' : '';
        box.innerHTML = `
            <div style="font-family:'Cinzel Decorative',serif;font-size:22px;color:#ff2244;text-shadow:0 0 16px #b01a2e;margin-bottom:14px;">💀 NO HEARTS LEFT</div>
            <div style="font-family:'Cinzel',serif;font-size:13px;color:#e8dfc8;line-height:1.9;margin-bottom:18px;">
                You have <strong style="color:#ff4466;">${potionCount}</strong> potion${plural}.<br>
                Use it to continue fighting?
            </div>
            <div style="display:flex;gap:10px;justify-content:center;">
                <button id="rescue-yes" style="background:linear-gradient(160deg,#6a0000,#cc1122);border:1px solid #ff3344;color:#fff;padding:10px 24px;font-size:9px;font-family:'Press Start 2P',monospace;cursor:pointer;clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px);">YES — USE POTION</button>
                <button id="rescue-no"  style="background:linear-gradient(160deg,#14101e,#201428);border:1px solid rgba(201,168,76,0.3);color:#8a7a60;padding:10px 24px;font-size:9px;font-family:'Press Start 2P',monospace;cursor:pointer;clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px);">NO — ACCEPT DEFEAT</button>
            </div>
        `;
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        box.querySelector('#rescue-yes').onclick = async () => {
            overlay.remove();
            try {
                const r = await fetch(`${BACKEND_URL}/arena/heal`, { method: 'POST', credentials: 'include' });
                const d = await r.json();
                if (d.ok) {
                    syncHealCountFromResponse(d);
                    gameState.playerHp = Math.min(1, gameState.playerMaxHp);
                    updatePlayerHearts();
                    updateConsumableBar();
                    showFloatingMessage('❤️ Revived by Potion!', '#ff4466');
                    resolve(true);
                    return;
                }
            } catch(e) {}
            resolve(false);
        };

        box.querySelector('#rescue-no').onclick = () => {
            overlay.remove();
            resolve(false);
        };
    });
}

// ============================================
// END GAME: DEFEAT
// ============================================
async function handleDefeat() {
    if (gameState.battleOver) return;

    // ── Potion rescue prompt: if player has a potion, offer to continue ──────
    const potionCount = getTotalHealCount();
    if (potionCount > 0) {
        const rescued = await showPotionRescuePrompt(potionCount);
        if (rescued) return; // Player used a potion — battle continues
    }
    // ─────────────────────────────────────────────────────────────────────────

    gameState.battleOver = true;
    clearQuestionTimer();
    try { localStorage.removeItem('cmai_active_boss'); } catch(e) {}
    clearProgress();
    const accuracy = gameState.totalAnswered > 0 ? Math.round((gameState.score/gameState.totalAnswered)*100) : 0;
    const wrong    = gameState.totalAnswered - gameState.score;
    document.getElementById('defeat-message').innerHTML = `
        <div style="font-family:'Cinzel',serif;font-size:14px;color:#cc3333;margin-bottom:12px;"><em>${gameState.monster.name}</em> has defeated you.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px;margin-bottom:12px;">
            <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(200,30,30,0.2);padding:12px;text-align:center;"><div style="font-size:9px;color:#8a7a60;font-family:'Cinzel',serif;margin-bottom:4px;">ACCURACY</div><div style="font-size:22px;color:#cc4444;font-family:'Cinzel Decorative',serif;">${accuracy}%</div></div>
            <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(200,30,30,0.2);padding:12px;text-align:center;"><div style="font-size:9px;color:#8a7a60;font-family:'Cinzel',serif;margin-bottom:4px;">MAX COMBO</div><div style="font-size:22px;color:#ff8800;font-family:'Cinzel Decorative',serif;">${gameState.maxCombo}✕</div></div>
        </div>
        <div style="font-family:'Cinzel',serif;font-size:11px;color:#664444;padding:8px;border:1px solid rgba(200,30,30,0.15);">⚔ Study the material and try again.</div>
        ${wrong > 0 ? `<button onclick="toggleDefeatReport()" id="defeat-report-btn" style="width:100%;background:rgba(180,30,30,0.12);border:1px solid rgba(180,30,30,0.3);color:#cc4444;padding:10px;font-size:11px;font-family:'Press Start 2P',monospace;cursor:pointer;margin-top:8px;">📖 Review Mistakes (${wrong})</button><div id="defeat-report-detail" style="display:none;margin-top:4px;max-height:240px;overflow-y:auto;"></div>` : ''}
    `;
    buildDefeatReport();
    document.getElementById('defeat-screen').classList.remove('hidden');
}

async function handleStalemate() {
    if (gameState.battleOver) return;
    gameState.battleOver = true;
    clearQuestionTimer();
    try { localStorage.removeItem('cmai_active_boss'); } catch(e) {}
    await showDialogue(gameState.monster.name.toUpperCase(), "Hmph... it seems we've reached an impasse. We'll meet again...", true);
    const defeatScreen = document.getElementById('defeat-screen');
    const defeatTitle  = defeatScreen.querySelector('.defeat-title');
    if (defeatTitle) { defeatTitle.textContent = '⚔️ STALEMATE ⚔️'; defeatTitle.style.color = '#ffaa00'; }
    document.getElementById('defeat-message').innerHTML = `<div style="color:#ffaa00;">The boss ran out of questions!</div><div style="margin:10px 0;font-size:12px;color:#aaa;">${gameState.totalAnswered} questions | ${Math.round((gameState.score/Math.max(1,gameState.totalAnswered))*100)}% accuracy</div>`;
    defeatScreen.classList.remove('hidden');
}

// ============================================
// BATTLE REPORTS
// ============================================
function buildBattleReport() {
    const c = document.getElementById('battle-report-detail');
    if (!c) return;
    const w = gameState.roundHistory.filter(r => !r.correct);
    if (!w.length) { c.innerHTML = '<div style="color:#00ff00;padding:10px;">Perfect score!</div>'; return; }
    c.innerHTML = w.map((e,i) => `<div style="background:rgba(255,0,0,0.08);border:1px solid #442222;border-radius:5px;padding:10px;margin-bottom:8px;"><div style="color:#ff6666;font-size:11px;margin-bottom:5px;">❌ Q${i+1}: ${e.question}</div><div style="font-size:10px;color:#aaa;">Your: <span style="color:#ff8888;">${e.userAnswer}</span> | Correct: <span style="color:#00ff00;">${e.correctAnswer}</span></div>${e.explanation?`<div style="font-size:10px;color:#88aaff;margin-top:5px;padding:5px;background:rgba(0,0,100,0.2);">💡 ${e.explanation}</div>`:''}</div>`).join('');
}
function buildDefeatReport() {
    const c = document.getElementById('defeat-report-detail');
    if (!c) return;
    const w = gameState.roundHistory.filter(r => !r.correct);
    c.innerHTML = w.map((e,i) => `<div style="background:rgba(255,0,0,0.08);border:1px solid #442222;border-radius:5px;padding:10px;margin-bottom:8px;"><div style="color:#ff6666;font-size:11px;margin-bottom:5px;">❌ Q${i+1}: ${e.question}</div><div style="font-size:10px;color:#aaa;">Your: <span style="color:#ff8888;">${e.userAnswer}</span> | Correct: <span style="color:#00ff00;">${e.correctAnswer}</span></div>${e.explanation?`<div style="font-size:10px;color:#88aaff;margin-top:5px;padding:5px;background:rgba(0,0,100,0.2);">💡 ${e.explanation}</div>`:''}</div>`).join('');
}
function toggleBattleReport() {
    const d = document.getElementById('battle-report-detail');
    const b = document.getElementById('report-toggle-btn');
    if (d.style.display==='none') { d.style.display='block'; b.textContent='📖 Hide Review'; }
    else { d.style.display='none'; b.textContent=`📖 Review Mistakes (${gameState.roundHistory.filter(r=>!r.correct).length})`; }
}
function toggleDefeatReport() {
    const d = document.getElementById('defeat-report-detail');
    d.style.display = d.style.display==='none' ? 'block' : 'none';
}

// ============================================
// UI UPDATES
// ============================================
function updateMonsterHP() {
    const pct  = Math.max(0, (gameState.monsterHp / gameState.monsterMaxHp) * 100);
    const fill = document.getElementById('monster-hp-fill');
    fill.style.width = `${pct}%`;
    fill.style.background = pct <= 25 ? 'linear-gradient(to right,#ff0000,#cc0000)' : 'linear-gradient(to right,#ff3333,#ff6666)';
    fill.classList.toggle('low-hp', pct <= 25);
    document.getElementById('monster-hp-current').textContent = Math.max(0, gameState.monsterHp);
}
function updatePlayerHearts() {
    document.querySelectorAll('.heart').forEach((h, i) => {
        h.classList.toggle('empty',  i >= gameState.playerHp);
        h.classList.toggle('danger', i < gameState.playerHp && gameState.playerHp === 1);
    });
}

// ── Consumable bar (potion + 50/50) ──────────────────────────────────────────
function updateConsumableBar() {
    const bar = document.getElementById('consumable-bar');
    if (!bar) return;
    bar.innerHTML = '';
    bar.style.display = 'flex';

    const potionCount = getTotalHealCount();

    // ── Potion slot: always shown; grey if none ──
    const potionBtn = document.createElement('button');
    if (potionCount > 0) {
        potionBtn.title = `Use Health Potion (+1 ❤️) — ${potionCount} left`;
        potionBtn.style.cssText = 'background:rgba(180,30,30,0.75);border:1px solid #ff4466;color:#fff;padding:4px 10px;font-size:9px;font-family:var(--px,monospace);cursor:pointer;border-radius:3px;transition:opacity .2s;';
        potionBtn.innerHTML = `🧪 Potion${potionCount > 1 ? ' (' + potionCount + ')' : ''}`;
        potionBtn.onclick = async () => {
            if (gameState.playerHp >= gameState.playerMaxHp) { showFloatingMessage('HP already full!', '#ff4466'); return; }
            potionBtn.disabled = true;
            try {
                // Single endpoint handles buff → inventory fallback automatically
                const r = await fetch(`${BACKEND_URL}/arena/heal`, { method: 'POST', credentials: 'include' });
                const d = await r.json();
                if (d.ok) {
                    syncHealCountFromResponse(d);
                    gameState.playerHp = Math.min(gameState.playerHp + 1, gameState.playerMaxHp);
                    updatePlayerHearts();
                    updateConsumableBar();
                    showFloatingMessage('❤️ +1 Heart!', '#ff4466');
                } else {
                    showFloatingMessage(d.reason || 'No potions left!', '#ff4466');
                    potionBtn.disabled = false;
                }
            } catch(e) { potionBtn.disabled = false; }
        };
    } else {
        // No potion — show greyed-out inaccessible slot
        potionBtn.title = 'No potions available';
        potionBtn.style.cssText = 'background:rgba(40,40,40,0.5);border:1px solid rgba(100,100,100,0.35);color:rgba(160,160,160,0.45);padding:4px 10px;font-size:9px;font-family:var(--px,monospace);cursor:not-allowed;border-radius:3px;';
        potionBtn.innerHTML = '🧪 Potion';
        potionBtn.disabled = true;
    }
    bar.appendChild(potionBtn);

    // ── Veil of Duality (50/50) slot: always show if charges, grey until question timer active ──
    const fifties = getTotalFiftyCount();
    if (fifties > 0) {
        const combatSection = document.getElementById('combat-section');
        // Veil is usable whenever a question with choices is active (timer or not)
        const hasChoices = document.querySelectorAll('.choice-btn:not([disabled]):not(.disabled)').length > 0;
        const questionActive = combatSection && !combatSection.classList.contains('hidden') && hasChoices;
        const fiftyBtn = document.createElement('button');
        fiftyBtn.title = questionActive
            ? `Veil of Duality — removes 2 wrong answers (×${fifties})`
            : 'Veil of Duality — use during a question with multiple choice answers';
        if (questionActive) {
            fiftyBtn.style.cssText = 'background:rgba(180,120,0,0.75);border:1px solid #f5c842;color:#fff;padding:4px 10px;font-size:9px;font-family:var(--px,monospace);cursor:pointer;border-radius:3px;transition:opacity .2s;';
        } else {
            fiftyBtn.style.cssText = 'background:rgba(40,35,0,0.4);border:1px solid rgba(120,90,0,0.35);color:rgba(180,150,60,0.45);padding:4px 10px;font-size:9px;font-family:var(--px,monospace);cursor:not-allowed;border-radius:3px;';
        }
        fiftyBtn.innerHTML = `⚖️ ×${fifties}`;
        if (!questionActive) {
            fiftyBtn.onclick = () => showFloatingMessage('⚖️ Use during a multiple-choice question!', '#f5c842');
        } else {
        fiftyBtn.onclick = async () => {
            // Re-evaluate at click time (state may have changed since bar was rendered)
            const _hasChoicesNow = document.querySelectorAll('.choice-btn:not([disabled]):not(.disabled)').length > 0;
            const _combatNow = document.getElementById('combat-section');
            const _activeNow = _combatNow && !_combatNow.classList.contains('hidden') && _hasChoicesNow;
            if (!_activeNow) { showFloatingMessage('⚖️ Use during a multiple-choice question!', '#f5c842'); return; }
            const charges = getTotalFiftyCount();
            if (charges <= 0) return;
            const currentQ = gameState.questions[gameState.currentQuestionIndex];
            const combatSection = document.getElementById('combat-section');
            if (!currentQ || !combatSection || combatSection.classList.contains('hidden')) {
                showFloatingMessage('⚖️ Use during a question!', '#f5c842');
                return;
            }
            try { await fetch(`${BACKEND_URL}/arena/fifty-fifty-use`, { method: 'POST', credentials: 'include' }); } catch(e) {}
            gameState._totalFiftyCount = Math.max(0, (gameState._totalFiftyCount || 1) - 1);
            gameState.fiftyFiftyCharges = gameState._totalFiftyCount; // keep alias in sync
            updateConsumableBar();
            // Eliminate 2 wrong choice buttons
            const correct = currentQ.correct_answer || currentQ.answer;
            const allBtns = Array.from(document.querySelectorAll('.choice-btn:not([disabled]):not(.disabled)'));
            const wrongBtns = allBtns.filter(b => {
                const btnText = b.textContent.trim();
                const corrText = correct.trim();
                const letterMatch = b.dataset.key && corrText.length === 1 && b.dataset.key === corrText.toUpperCase();
                const containsMatch = btnText.includes(corrText) || corrText.includes(btnText);
                return !(btnText === corrText || letterMatch || containsMatch);
            });
            wrongBtns.sort(() => Math.random() - 0.5).slice(0, 2).forEach(b => {
                b.style.opacity = '0.18';
                b.style.pointerEvents = 'none';
                b.style.textDecoration = 'line-through';
            });
            showFloatingMessage('⚖️ 50/50 used!', '#f5c842');
        };
        } // end else (questionActive)
        bar.appendChild(fiftyBtn);
    }
}

// Total heals remaining this battle (unified counter set at init, decremented on use)
function getTotalHealCount() {
    return gameState._totalHealCount || 0;
}
// Total 50/50 charges remaining (unified counter)
function getTotalFiftyCount() {
    return gameState._totalFiftyCount || 0;
}
// Sync total heal count from /arena/heal response
function syncHealCountFromResponse(d) {
    if (d.remaining_total !== undefined) {
        gameState._totalHealCount = d.remaining_total;
    } else if (d.remaining_buff !== undefined) {
        // fallback — sum buff + inv from response
        gameState._totalHealCount = (d.remaining_buff || 0) + (d.remaining_inv || 0);
    } else {
        // simple decrement
        gameState._totalHealCount = Math.max(0, (gameState._totalHealCount || 1) - 1);
    }
    // Keep legacy aliases in sync
    gameState._pendingHeal = gameState._totalHealCount;
    gameState._healCount   = gameState._totalHealCount;
}
function loseHeart() {
    // Use the index of the heart just lost (playerHp was already decremented).
    // Querying '.heart:not(.empty)' is unreliable when updatePlayerHearts() runs
    // concurrently — the wrong heart can get the animation, making it look like
    // 2 hearts disappear at once. Index-based targeting is always correct.
    const hearts = document.querySelectorAll('.heart');
    const idx = gameState.playerHp; // this heart is now "the lost one"
    if (idx >= 0 && idx < hearts.length) {
        const h = hearts[idx];
        h.classList.add('heart-lost');
        setTimeout(() => { h.classList.remove('heart-lost'); }, 700);
    }
}
function enableInputs() {
    document.querySelectorAll('.choice-btn, #text-submit-btn').forEach(b => b.classList.remove('disabled'));
    const inp = document.getElementById('text-answer-input'); if (inp) inp.disabled = false;
}
function disableInputs() {
    document.querySelectorAll('.choice-btn, #text-submit-btn').forEach(b => b.classList.add('disabled'));
    const inp = document.getElementById('text-answer-input'); if (inp) inp.disabled = true;
}

// ============================================
// QUESTION TIMER (with speed ring)
// ============================================
function startQuestionTimer(question) {
    // Clear any previous timer WITHOUT touching _questionTimerRunning flag
    if (gameState.questionTimer) { clearInterval(gameState.questionTimer); gameState.questionTimer = null; }
    updateSpeedRing(0, 0);
    gameState._questionTimerRunning = true;
    updateConsumableBar(); // un-grey the Veil of Duality btn
    let timeLeft = gameState.timePerQuestion, cancelled = false;
    updateSpeedRing(timeLeft, gameState.timePerQuestion);
    gameState.questionTimer = setInterval(() => {
        if (cancelled) return;
        timeLeft--;
        updateSpeedRing(timeLeft, gameState.timePerQuestion);
        const hintEl = document.getElementById('combat-hint');
        const diff   = question.difficulty || 'medium';
        const modeColors = { easy:'🟢', medium:'🟡', hard:'🔴', nightmare:'☠' };
        const modeLabel  = (gameState.difficulty || 'hard').toUpperCase();
        const modeIcon   = modeColors[gameState.difficulty] || '🔴';
        const timerColor = timeLeft <= 5 ? '#ff3333' : timeLeft <= 10 ? '#ffaa00' : '#888';
        const baseDmg  = 15 + (gameState.level * 3);
        const comboDmg = Math.min(gameState.combo * 3, 25);
        const diffBonus = question.difficulty === 'hard' ? 10 : question.difficulty === 'medium' ? 5 : 0;
        const preview  = Math.round(((baseDmg+comboDmg+diffBonus)/gameState.monsterMaxHp)*100);
        let h = `${modeIcon} ${modeLabel} | ⏰ <span style="color:${timerColor}">${timeLeft}s</span> | ⚔ <span style="color:#f5d27a">~${preview}%</span>`;
        if (gameState.combo > 0)    h += ` | 🔥 ${gameState.combo}x`;
        if (checkWeakness(question)) h += ` <span style="color:#ffe000">⚡2×</span>`;
        if (gameState.comboShield)   h += ` <span style="color:#88ccff">🛡</span>`;
        hintEl.innerHTML = h;
        if (timeLeft <= 0) { cancelled = true; clearQuestionTimer(); handleAnswer('__TIMEOUT__', question.correct_answer, question); }
    }, 1000);
}
function clearQuestionTimer() {
    gameState._questionTimerRunning = false;
    if (gameState.questionTimer) { clearInterval(gameState.questionTimer); gameState.questionTimer = null; }
    updateSpeedRing(0, 0);
}

// ============================================
// MCQ + TEXT INPUT
// ============================================
function showMCQOptions(question) {
    const grid = document.getElementById('choices-grid');
    const text = document.getElementById('text-answer-container');
    grid.classList.remove('hidden'); text.classList.add('hidden');
    grid.innerHTML = '';
    question.options.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'choice-btn';
        btn.textContent = opt;
        btn.dataset.key = String.fromCharCode(65+i);
        btn.dataset.index = i;
        btn.onclick = () => handleAnswer(opt, question.correct_answer, question);
        grid.appendChild(btn);
    });
}
function showTextInput(question) {
    document.getElementById('choices-grid').classList.add('hidden');
    const tc  = document.getElementById('text-answer-container');
    const inp = document.getElementById('text-answer-input');
    const btn = document.getElementById('text-submit-btn');
    tc.classList.remove('hidden'); inp.value = ''; inp.disabled = false;
    const submit = () => { const a = inp.value.trim(); if (a) handleAnswer(a, question.correct_answer, question); };
    btn.onclick = submit;
    inp.onkeypress = e => { if (e.key === 'Enter') submit(); };
    setTimeout(() => inp.focus(), 100);
}

// ============================================
// DIALOGUE SYSTEM
// ============================================
async function showDialogue(speaker, text, waitForClick = false) {
    const container  = document.getElementById('dialogue-container');
    const speakerEl  = document.getElementById('dialogue-speaker');
    const textEl     = document.getElementById('dialogue-text');
    const continueEl = document.getElementById('dialogue-continue');
    container.classList.remove('hidden');
    speakerEl.textContent = speaker;
    textEl.textContent = '';
    let i = 0, skip = false;
    return new Promise(resolve => {
        const skipHandler = () => { if (i < text.length) skip = true; };
        container.addEventListener('click', skipHandler);
        const iv = setInterval(() => {
            if (skip) { textEl.textContent = text; clearInterval(iv); container.removeEventListener('click', skipHandler); finish(); return; }
            if (i < text.length) textEl.textContent += text[i++];
            else { clearInterval(iv); container.removeEventListener('click', skipHandler); finish(); }
        }, 18);
        function finish() {
            if (waitForClick) {
                continueEl.classList.remove('hidden');
                continueEl.textContent = '▼ Click to Continue';
                container.onclick = () => { continueEl.classList.add('hidden'); container.onclick = null; resolve(); };
            } else { setTimeout(resolve, 500); }
        }
    });
}

// ============================================
// VISUAL EFFECTS
// ============================================
function flashScreen(color) {
    const c = document.getElementById('game-container');
    c.classList.add(`flash-${color}`);
    setTimeout(() => c.classList.remove(`flash-${color}`), 300);
}
function shakeScreen() {
    const c = document.getElementById('game-container');
    c.classList.add('shake');
    setTimeout(() => c.classList.remove('shake'), 300);
}
function triggerMonsterHit() {
    const m = document.querySelector('.monster-sprite') || document.getElementById('boss-main-canvas');
    if (m) { m.classList.add('hit-anim'); setTimeout(() => m.classList.remove('hit-anim'), 450); }
}
function showDamageNumber(damage, isCrit) {
    const pw = document.getElementById('player-canvas-wrap') || document.getElementById('player-side');
    const el = document.createElement('div');
    el.className = 'damage-number' + (isCrit ? ' critical' : '');
    el.textContent = `-${damage}`;
    if (pw) {
        const r = pw.getBoundingClientRect();
        el.style.left = (r.left + r.width*0.5 + (Math.random()-0.5)*30) + 'px';
        el.style.top  = (r.top - 20 + Math.random()*15) + 'px';
    } else { el.style.left = (window.innerWidth*0.08) + 'px'; el.style.top = (window.innerHeight*0.4) + 'px'; }
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
}
function createConfetti() {
    for (let i = 0; i < 50; i++) {
        const c = document.createElement('div');
        c.style.cssText = `position:fixed;left:${Math.random()*100}vw;top:-10px;width:10px;height:10px;background:hsl(${Math.random()*360},100%,50%);z-index:10001;pointer-events:none;`;
        document.body.appendChild(c);
        const a = c.animate([{transform:'translateY(0) rotate(0)',opacity:1},{transform:`translateY(100vh) rotate(${Math.random()*720}deg)`,opacity:0}],{duration:Math.random()*2000+1000,easing:'cubic-bezier(0.25,0.46,0.45,0.94)'});
        a.onfinish = () => c.remove();
    }
}
function showFloatingMessage(text, color='#f5d27a') {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = `position:fixed;left:50%;top:30%;transform:translateX(-50%);color:${color};font-family:'Cinzel Decorative',serif;font-size:18px;text-shadow:0 0 15px ${color};pointer-events:none;z-index:6000;`;
    el.animate([{opacity:1,transform:'translateX(-50%) translateY(0)'},{opacity:0,transform:'translateX(-50%) translateY(-40px)'}],{duration:1800,easing:'ease-out'}).onfinish = () => el.remove();
    document.body.appendChild(el);
}


// ============================================
// BATTLE-END INVENTORY SYNC
// ============================================
async function syncInventoryToBackend() {
    /** Push the exact remaining counts back to the server so the
        frontend (shop/inventory/sidebar) shows the correct numbers
        after the player returns to CourseMateAI. */
    const potion = getTotalHealCount();
    const fifty  = getTotalFiftyCount();
    try {
        await fetch(`${BACKEND_URL}/arena/sync-inventory`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ potion_health_small: potion, fifty_fifty: fifty }),
        });
    } catch(e) {
        console.warn('Inventory sync failed:', e);
    }
}

// ============================================
// LOADING / UTILITY
// ============================================
function showLoadingScreen() { document.getElementById('loading-screen').classList.remove('hidden'); }
function hideLoadingScreen() { document.getElementById('loading-screen').classList.add('hidden'); }
function updateLoadingText(t) { document.getElementById('loading-text').textContent = t; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function returnToStreamlit() {
    // Sync final item counts back to the server before closing
    await syncInventoryToBackend();
    if (gameState._battleRewards && window.opener) {
        window.opener.postMessage({
            type: 'CMAI_BATTLE_REWARDS',
            xp_gained:    gameState._battleRewards.xp_gained,
            coins_gained: gameState._battleRewards.coins_gained,
        }, '*');
    }
    setTimeout(() => { window.close(); setTimeout(() => { if (!window.closed) alert('Please close this tab.'); }, 100); }, 150);
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================
document.addEventListener('keydown', e => {
    if (['1','2','3','4'].includes(e.key)) {
        const btns = document.querySelectorAll('.choice-btn');
        const btn  = btns[parseInt(e.key)-1];
        if (btn && !btn.classList.contains('disabled')) btn.click();
    }
    if (e.key === ' ' || e.key === 'Enter') {
        const cont = document.getElementById('dialogue-continue');
        if (cont && !cont.classList.contains('hidden')) { const c = document.getElementById('dialogue-container'); if (c.onclick) c.onclick(); }
    }
    if (e.key === 'p' || e.key === 'P') {
        const btn = document.querySelector('.power-card-use-btn');
        if (btn) btn.click();
    }
});

// ============================================
// ─── WEAKNESS CHECK ────────────────────────
// ============================================
function checkWeakness(question) {
    const weakness = (gameState.bossData?.weakness || '').toLowerCase();
    if (!weakness) return false;
    const concept = (question.concept || '').toLowerCase();
    return concept.includes(weakness) || weakness.includes(concept) || (gameState.topic||'').toLowerCase().includes(weakness);
}

// ============================================
// ─── STREAK MULTIPLIER BADGE ───────────────
// ============================================
function updateStreakBadge(combo) {
    let badge = document.getElementById('streak-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'streak-badge';
        badge.style.cssText = 'position:fixed;left:24px;bottom:180px;z-index:3000;font-family:Cinzel Decorative,serif;font-size:24px;pointer-events:none;transition:opacity 0.15s;opacity:0;';
        document.body.appendChild(badge);
    }
    if (combo <= 1) { badge.style.opacity='0'; return; }
    const m = Math.min(combo, 9);
    const hue = Math.max(0, 40 - combo*3);
    badge.textContent = `${m}×`;
    badge.style.color = `hsl(${hue},100%,60%)`;
    badge.style.textShadow = `0 0 ${12+combo*2}px hsl(${hue},100%,60%)`;
    badge.style.opacity = '1';
    badge.animate([{transform:'scale(1.25)'},{transform:'scale(1)'}],{duration:200,easing:'ease-out'});
}
function shatterStreakBadge() {
    const badge = document.getElementById('streak-badge');
    if (!badge || badge.style.opacity==='0') return;
    badge.animate([{transform:'scale(1.3) rotate(-5deg)',opacity:1},{transform:'scale(0.1) rotate(20deg)',opacity:0}],{duration:400,easing:'ease-in'}).onfinish = () => { badge.style.opacity='0'; };
}

// ============================================
// ─── COMBO SHIELD UI ───────────────────────
// ============================================
function updateComboShieldUI(active) {
    let shield = document.getElementById('combo-shield-indicator');
    if (!shield) {
        shield = document.createElement('div');
        shield.id = 'combo-shield-indicator';
        shield.innerHTML = '🛡';
        shield.style.cssText = 'position:fixed;left:24px;bottom:140px;z-index:3000;font-size:28px;pointer-events:none;filter:drop-shadow(0 0 8px #88ccff);transition:opacity 0.3s,transform 0.3s;opacity:0;';
        document.body.appendChild(shield);
    }
    shield.style.opacity  = active ? '1' : '0';
    shield.style.transform = active ? 'scale(1)' : 'scale(0.5)';
    if (active) shield.animate([{transform:'scale(1.4)'},{transform:'scale(1)'}],{duration:300,easing:'ease-out'});
}

// ============================================
// ─── SPEED RING ────────────────────────────
// ============================================
function updateSpeedRing(timeLeft, total) {
    let ring = document.getElementById('speed-ring');
    if (!ring) {
        ring = document.createElement('div');
        ring.id = 'speed-ring';
        ring.innerHTML = `<svg viewBox="0 0 44 44" width="44" height="44" style="transform:rotate(-90deg)"><circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,200,0,0.12)" stroke-width="3"/><circle id="speed-ring-arc" cx="22" cy="22" r="18" fill="none" stroke="#ffe000" stroke-width="3" stroke-dasharray="113.1" stroke-dashoffset="113.1" stroke-linecap="round"/></svg>`;
        ring.style.cssText = 'position:fixed;right:20px;bottom:190px;z-index:3000;pointer-events:none;transition:opacity 0.2s;';
        document.body.appendChild(ring);
    }
    if (!total) { ring.style.opacity='0'; return; }
    const arc = document.getElementById('speed-ring-arc');
    if (!arc) return;
    const pct = Math.max(0, timeLeft/total);
    const circ = 2*Math.PI*18;
    arc.style.strokeDashoffset = circ * (1-pct);
    arc.style.stroke = `hsl(${Math.round(pct*40)},100%,60%)`;
    ring.style.opacity = timeLeft > 0 ? '1' : '0';
}

// ============================================
// ─── POWER CARDS ───────────────────────────
// ============================================
const POWER_CARD_META = {
    SKIP_QUESTION:  { icon:'⏭', label:'Skip Question',          color:'#cc88ff' },
    REMOVE_2_WRONG: { icon:'✂️', label:'Remove 2 Wrong Options', color:'#88ffcc' },
    ADD_30_SECONDS: { icon:'⏱',  label:'+30 Seconds',            color:'#ffcc44' },
};
async function drawPowerCard() {
    const types = Object.keys(POWER_CARD_META);
    const cards = [...new Set([types[Math.floor(Math.random()*3)],types[Math.floor(Math.random()*3)],types[Math.floor(Math.random()*3)]])];
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(4,2,8,0.93);z-index:9000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);';
        overlay.innerHTML = `
            <div style="text-align:center;max-width:520px;width:90%;padding:32px 24px;border:1px solid rgba(201,168,76,0.3);background:linear-gradient(160deg,rgba(14,6,22,0.98),rgba(6,3,12,0.99));clip-path:polygon(0 0,calc(100% - 20px) 0,100% 20px,100% 100%,20px 100%,0 calc(100% - 20px));">
                <div style="font-family:'Cinzel Decorative',serif;font-size:14px;color:#f5d27a;letter-spacing:3px;margin-bottom:6px;">⚡ POWER CARD ⚡</div>
                <div style="font-family:'Cinzel',serif;font-size:11px;color:#8a7a60;margin-bottom:24px;">7 correct in a row! Choose a reward:</div>
                <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;" id="card-row"></div>
                <div style="margin-top:16px;font-family:'Cinzel',serif;font-size:10px;color:#554444;"><span id="card-skip-btn" style="color:#c9a84c;cursor:pointer;text-decoration:underline;">Skip</span></div>
            </div>`;
        const row = overlay.querySelector('#card-row');
        cards.forEach(type => {
            const m = POWER_CARD_META[type];
            const card = document.createElement('div');
            card.style.cssText = `background:rgba(0,0,0,0.6);border:2px solid ${m.color}44;padding:20px 16px;cursor:pointer;min-width:130px;transition:all 0.18s;clip-path:polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,8px 100%,0 calc(100% - 8px));`;
            card.innerHTML = `<div style="font-size:28px;margin-bottom:8px;">${m.icon}</div><div style="font-family:'Cinzel Decorative',serif;font-size:10px;color:${m.color};">${m.label}</div>`;
            card.onmouseover = () => { card.style.borderColor = m.color; card.style.transform = 'translateY(-4px)'; card.style.boxShadow = `0 0 20px ${m.color}44`; };
            card.onmouseout  = () => { card.style.borderColor = `${m.color}44`; card.style.transform = ''; card.style.boxShadow = ''; };
            card.onclick = () => { document.body.removeChild(overlay); gameState.powerCards.push(type); renderPowerCardSlot(); resolve(); };
            row.appendChild(card);
        });
        overlay.querySelector('#card-skip-btn').onclick = () => { document.body.removeChild(overlay); resolve(); };
        document.body.appendChild(overlay);
    });
}
function renderPowerCardSlot() {
    let slot = document.getElementById('power-card-slot');
    if (!slot) {
        slot = document.createElement('div');
        slot.id = 'power-card-slot';
        slot.style.cssText = 'position:fixed;right:20px;bottom:250px;z-index:3000;display:flex;flex-direction:column;gap:4px;';
        document.body.appendChild(slot);
    }
    slot.innerHTML = '';
    if (!gameState.powerCards.length) return;
    const type = gameState.powerCards[0];
    const m    = POWER_CARD_META[type];
    const card = document.createElement('div');
    card.innerHTML = `<span>${m.icon}</span><span style="font-size:8px;font-family:'Cinzel',serif;color:${m.color};margin-left:5px;">${m.label}</span>`;
    card.className = 'power-card-use-btn';
    card.title = `[P] ${m.label}`;
    card.style.cssText = `background:rgba(0,0,0,0.85);border:1px solid ${m.color}66;padding:6px 10px;cursor:pointer;display:flex;align-items:center;transition:all 0.15s;clip-path:polygon(0 0,calc(100% - 6px) 0,100% 6px,100% 100%,6px 100%,0 calc(100% - 6px));`;
    card.onmouseover = () => { card.style.boxShadow = `0 0 14px ${m.color}44`; };
    card.onmouseout  = () => { card.style.boxShadow = ''; };
    card.onclick = () => usePowerCard(type);
    const cnt = document.createElement('div');
    cnt.style.cssText = 'font-family:Cinzel,serif;font-size:9px;color:#8a7a60;text-align:right;padding:1px 3px;';
    cnt.textContent = `${gameState.powerCards.length} card${gameState.powerCards.length>1?'s':''} [P]`;
    slot.appendChild(card); slot.appendChild(cnt);
}
function usePowerCard(type) {
    const idx = gameState.powerCards.indexOf(type);
    if (idx === -1) return;
    gameState.powerCards.splice(idx, 1);
    renderPowerCardSlot();
    const q = gameState.questions[gameState.currentQuestionIndex];
    if (type === 'SKIP_QUESTION') {
        showFloatingMessage('⏭ Question Skipped!', '#cc88ff');
        gameState.currentQuestionIndex++;
        clearQuestionTimer();
        document.getElementById('combat-section').classList.add('hidden');
        setTimeout(() => displayQuestion(), 400);
    } else if (type === 'REMOVE_2_WRONG') {
        const btns = Array.from(document.querySelectorAll('.choice-btn:not(.disabled)'));
        const correctEl = btns.find(b => q && checkAnswer(b.textContent, q.correct_answer));
        btns.filter(b => b !== correctEl).sort(() => Math.random()-0.5).slice(0,2).forEach(b => { b.style.opacity='0.2'; b.style.pointerEvents='none'; });
        showFloatingMessage('✂️ 2 Wrong Options Removed!', '#88ffcc');
    } else if (type === 'ADD_30_SECONDS') {
        gameState.timePerQuestion += 30;
        showFloatingMessage('⏱ +30 Seconds!', '#ffcc44');
    }
}

// ============================================
// ─── GHOST REPLAY ──────────────────────────
// ============================================
function initGhostBar() {
    let bar = document.getElementById('ghost-hp-bar');
    if (bar || !gameState.ghostData?.length) return;
    const hpSection = document.getElementById('boss-hp-section');
    if (!hpSection) return;
    bar = document.createElement('div');
    bar.id = 'ghost-hp-bar';
    bar.style.cssText = 'position:relative;width:100%;height:10px;background:rgba(0,0,0,0.6);border:1px solid rgba(120,120,200,0.2);margin-top:3px;overflow:hidden;';
    bar.innerHTML = `<div id="ghost-hp-fill" style="height:100%;background:linear-gradient(to right,rgba(120,120,255,0.35),rgba(180,180,255,0.55));transition:width 0.6s ease;width:100%;"></div><div style="position:absolute;top:50%;right:4px;transform:translateY(-50%);font-size:7px;color:rgba(180,180,255,0.5);font-family:'Cinzel',serif;pointer-events:none;">👻 prev run</div>`;
    hpSection.appendChild(bar);
    updateGhostBar();
}
function updateGhostBar() {
    if (!gameState.ghostData?.length) return;
    const fill = document.getElementById('ghost-hp-fill');
    if (!fill) return;
    const idx  = Math.min(gameState.totalAnswered, gameState.ghostData.length-1);
    const snap = gameState.ghostData[idx];
    if (!snap) return;
    fill.style.width = `${Math.max(0,(snap.bossHp/gameState.monsterMaxHp)*100)}%`;
}
function saveGhostRun(topic, difficulty) {
    if (!gameState.currentRunLog.length) return;
    const key = `cmai_ghost_${topic}_${difficulty}`.replace(/\s/g,'_');
    try { localStorage.setItem(key, JSON.stringify(gameState.currentRunLog)); } catch(e) {}
}
function loadGhostRun(topic, difficulty) {
    try { const r = localStorage.getItem(`cmai_ghost_${topic}_${difficulty}`.replace(/\s/g,'_')); return r ? JSON.parse(r) : null; } catch(e) { return null; }
}

// ============================================
// ─── PERSONAL BEST ─────────────────────────
// ============================================
function savePersonalBest(topic, difficulty, time, accuracy, grade) {
    const key = `cmai_pb_${topic}_${difficulty}`.replace(/\s/g,'_');
    try { localStorage.setItem(key, JSON.stringify({ time, accuracy, grade, date:new Date().toISOString().slice(0,10) })); } catch(e) {}
}
function loadPersonalBest(topic, difficulty) {
    try { const r = localStorage.getItem(`cmai_pb_${topic}_${difficulty}`.replace(/\s/g,'_')); return r ? JSON.parse(r) : null; } catch(e) { return null; }
}
function renderPersonalBest(pb) {
    const loadingText = document.getElementById('loading-text');
    if (!loadingText?.parentNode) return;
    const mins = Math.floor(pb.time/60), secs = pb.time%60;
    const banner = document.createElement('div');
    banner.style.cssText = 'font-family:Cinzel,serif;font-size:10px;color:#c9a84c;letter-spacing:1px;margin-top:10px;padding:6px 12px;border:1px solid rgba(201,168,76,0.25);background:rgba(201,168,76,0.05);text-align:center;';
    banner.textContent = `🏆 Personal Best: ${pb.grade} · ${pb.accuracy}% · ${mins}m${secs}s`;
    loadingText.parentNode.insertBefore(banner, loadingText.nextSibling);
}

// ============================================
// ─── CONCEPT COVERAGE MAP ──────────────────
// ============================================
function updateCoverageMap() {
    let panel = document.getElementById('coverage-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'coverage-panel';
        panel.style.cssText = 'position:fixed;left:8px;top:50px;z-index:2500;max-width:155px;background:rgba(4,2,8,0.88);border:1px solid rgba(201,168,76,0.18);padding:8px 10px;font-family:Cinzel,serif;max-height:50vh;overflow-y:auto;';
        panel.innerHTML = '<div style="font-size:7px;color:#8a7a60;letter-spacing:2px;margin-bottom:6px;border-bottom:1px solid rgba(201,168,76,0.12);padding-bottom:4px;">COVERAGE</div><div id="coverage-concepts"></div>';
        document.body.appendChild(panel);
    }
    const list = document.getElementById('coverage-concepts');
    if (!list) return;
    list.innerHTML = '';
    Object.entries(gameState.conceptsCovered).forEach(([concept, stats]) => {
        const acc = stats.total > 0 ? Math.round((stats.correct/stats.total)*100) : 0;
        const color = acc >= 80 ? '#22cc55' : acc >= 50 ? '#ffaa00' : '#cc3344';
        const el = document.createElement('div');
        el.style.cssText = `font-size:8px;color:${color};margin-bottom:4px;display:flex;justify-content:space-between;gap:4px;`;
        const name = concept.length > 13 ? concept.slice(0,12)+'…' : concept;
        el.innerHTML = `<span>${acc>=80?'✓':acc>=50?'~':'✗'} ${name}</span><span style="color:#8a7a60">${stats.correct}/${stats.total}</span>`;
        list.appendChild(el);
    });
}

// ============================================
// ─── PHASE 2 SHOP ──────────────────────────
// ============================================
async function showPhase2Shop() {
    // Sync fresh data before showing the shop
    try {
        const [shopRes, hudRes] = await Promise.all([
            fetch(`${BACKEND_URL}/shop`, { credentials: 'include' }),
            fetch(`${BACKEND_URL}/hud`,  { credentials: 'include' }),
        ]);
        if (shopRes.ok) {
            const shopData = await shopRes.json();
            if (shopData.coins !== undefined) gameState.coins = shopData.coins;
            gameState._shopInventory = {};
            (shopData.items || []).forEach(item => {
                if (item.consumable) gameState._shopInventory[item.id] = item.quantity || 0;
            });
        }
        if (hudRes.ok) {
            const hudData = await hudRes.json();
            const healBuff  = hudData.buffs?.heal_1?.count      ? parseInt(hudData.buffs.heal_1.count)      || 0 : 0;
            const fiftyBuff = hudData.buffs?.fifty_fifty?.count  ? parseInt(hudData.buffs.fifty_fifty.count) || 0 : 0;
            const healInv   = gameState._shopInventory?.['potion_health_small'] || 0;
            const fiftyInv  = gameState._shopInventory?.['fifty_fifty']         || 0;
            // Keep _totalHealCount / _totalFiftyCount in sync (same pattern as game init)
            gameState._totalHealCount  = healInv  + healBuff;
            gameState._totalFiftyCount = fiftyInv + fiftyBuff;
            gameState._pendingHeal     = gameState._totalHealCount;
            gameState._healCount       = gameState._totalHealCount;
            gameState.fiftyFiftyCharges = gameState._totalFiftyCount;
        }
    } catch (e) {
        console.warn('Phase2 shop sync failed', e);
    }

    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(4,2,8,0.95);z-index:9500;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);';

        const render = () => {
            const potionMaxStack = 3;  // must match shop_service.STACK_LIMITS
            const fiftyMaxStack  = 2;

            // ── Crimson Vial (health potion) ──────────────────────────────
            const potionQty   = getTotalHealCount();  // unified battle counter
            const potionAtMax = potionQty >= potionMaxStack;

            // ── Veil of Duality (50/50) ───────────────────────────────────
            const fiftyQty   = getTotalFiftyCount();  // unified battle counter
            const fiftyAtMax = fiftyQty >= fiftyMaxStack;

            const potionCanBuy   = !potionAtMax && gameState.coins >= 80;
            const fiftyCanBuy    = !fiftyAtMax  && gameState.coins >= 60;

            const potionBtnHtml  = potionAtMax
                ? `<div style="font-size:8px;color:#c9a84c;margin-top:6px;border:1px solid rgba(201,168,76,0.3);padding:4px 8px;">MAX STACK (${potionQty}/${potionMaxStack})</div>`
                : potionCanBuy
                    ? `<div style="font-size:8px;color:#c9a84c;margin-top:6px;">80 🪙 — click to BUY</div>`
                    : `<div style="font-size:8px;color:#664444;margin-top:6px;">Need more coins</div>`;

            const fiftyBtnHtml   = fiftyAtMax
                ? `<div style="font-size:8px;color:#c9a84c;margin-top:6px;border:1px solid rgba(201,168,76,0.3);padding:4px 8px;">MAX STACK (${fiftyQty}/${fiftyMaxStack})</div>`
                : fiftyCanBuy
                    ? `<div style="font-size:8px;color:#c9a84c;margin-top:6px;">60 🪙 — click to BUY</div>`
                    : `<div style="font-size:8px;color:#664444;margin-top:6px;">Need more coins</div>`;

            overlay.innerHTML = `
            <div style="text-align:center;max-width:560px;width:92%;padding:32px 24px;border:1px solid rgba(201,168,76,0.4);background:linear-gradient(160deg,rgba(14,6,22,0.99),rgba(6,3,12,0.99));clip-path:polygon(0 0,calc(100% - 20px) 0,100% 20px,100% 100%,20px 100%,0 calc(100% - 20px));">
                <div style="font-family:'Cinzel Decorative',serif;font-size:13px;color:#f5d27a;letter-spacing:3px;margin-bottom:4px;">⚔ PHASE II APPROACHES ⚔</div>
                <div style="font-family:'Cinzel',serif;font-size:11px;color:#8a7a60;margin-bottom:20px;">Stock up before the boss unleashes true power</div>
                <div style="font-family:'Cinzel Decorative',serif;font-size:13px;color:#c9a84c;margin-bottom:20px;">🪙 ${gameState.coins} coins</div>

                <div style="display:flex;gap:14px;justify-content:center;margin-bottom:8px;">

                    <!-- Crimson Vial -->
                    <div class="shop2-item" data-type="potion" data-can-buy="${potionCanBuy}" data-cost="80"
                         style="background:rgba(0,0,0,0.6);border:1px solid ${potionAtMax ? 'rgba(201,168,76,0.5)' : 'rgba(200,50,50,0.35)'};padding:18px 16px;cursor:${potionCanBuy ? 'pointer' : 'default'};min-width:140px;transition:all 0.18s;clip-path:polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,8px 100%,0 calc(100% - 8px));opacity:${potionCanBuy || potionAtMax ? '1' : '0.55'};">
                        <div style="font-size:28px;margin-bottom:8px;">🧪</div>
                        <div style="font-family:'Cinzel Decorative',serif;font-size:10px;color:#ff6677;">Crimson Vial</div>
                        <div style="font-family:'Cinzel',serif;font-size:9px;color:#8a7a60;margin-top:4px;">+1 Heart in battle</div>
                        <div style="font-family:'Cinzel Decorative',serif;font-size:14px;color:#ff6677;margin-top:10px;letter-spacing:2px;">×${potionQty} <span style="font-size:10px;color:#8a7a60;">/${potionMaxStack}</span></div>
                        ${potionBtnHtml}
                    </div>

                    <!-- Veil of Duality (50/50) -->
                    <div class="shop2-item" data-type="fifty" data-can-buy="${fiftyCanBuy}" data-cost="60"
                         style="background:rgba(0,0,0,0.6);border:1px solid ${fiftyAtMax ? 'rgba(201,168,76,0.5)' : 'rgba(180,120,0,0.3)'};padding:18px 16px;cursor:${fiftyCanBuy ? 'pointer' : 'default'};min-width:140px;transition:all 0.18s;clip-path:polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,8px 100%,0 calc(100% - 8px));opacity:${fiftyCanBuy || fiftyAtMax ? '1' : '0.55'};">
                        <div style="font-size:28px;margin-bottom:8px;">⚖️</div>
                        <div style="font-family:'Cinzel Decorative',serif;font-size:10px;color:#f5c842;">Veil of Duality</div>
                        <div style="font-family:'Cinzel',serif;font-size:9px;color:#8a7a60;margin-top:4px;">Removes 2 wrong answers</div>
                        <div style="font-family:'Cinzel Decorative',serif;font-size:14px;color:#f5c842;margin-top:10px;letter-spacing:2px;">×${fiftyQty} <span style="font-size:10px;color:#8a7a60;">/${fiftyMaxStack}</span></div>
                        ${fiftyBtnHtml}
                    </div>

                </div>

                <div style="font-family:'Cinzel',serif;font-size:9px;color:#554433;margin-bottom:20px;padding:6px 12px;border:1px solid rgba(80,50,0,0.3);background:rgba(80,50,0,0.1);">
                    ⚔ Potions are used from the battle HUD — <em>Veil of Duality activates during any multiple-choice question</em>
                </div>

                <button id="shop2-continue" style="background:linear-gradient(160deg,#6a3000,#c06000);border:1px solid #c9a84c;color:#fff;padding:10px 28px;font-size:9px;font-family:'Press Start 2P',monospace;cursor:pointer;clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);">⚔ ENTER PHASE II</button>
            </div>`;

            // ── Buy handlers ──────────────────────────────────────────────
            overlay.querySelectorAll('.shop2-item').forEach(item => {
                const type    = item.dataset.type;
                const cost    = parseInt(item.dataset.cost);
                const canBuy  = item.dataset.canBuy === 'true';

                if (!canBuy) return; // max stack or no coins — not interactive
                item.onmouseover = () => { item.style.transform='translateY(-3px)'; item.style.boxShadow='0 0 20px rgba(201,168,76,0.15)'; };
                item.onmouseout  = () => { item.style.transform=''; item.style.boxShadow=''; };
                item.onclick = async () => {
                    if (gameState.coins < cost) return;
                    try {
                        const br = await fetch(`${BACKEND_URL}/shop/purchase`, {
                            method: 'POST', credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ user_id: gameState.userId, item_id: type === 'potion' ? 'potion_health_small' : 'fifty_fifty' }),
                        });
                        const bd = await br.json();
                        if (!bd.ok) { showFloatingMessage(bd.reason || 'Purchase failed', '#ff4466'); return; }
                        gameState.coins -= cost;
                        // Update local inventory
                        // Phase-2 buy increments the total battle counter directly
                        if (type === 'potion') {
                            gameState._totalHealCount  = (gameState._totalHealCount  || 0) + 1;
                            gameState._pendingHeal     = gameState._totalHealCount;
                            gameState._healCount       = gameState._totalHealCount;
                        } else {
                            gameState._totalFiftyCount  = (gameState._totalFiftyCount  || 0) + 1;
                            gameState.fiftyFiftyCharges = gameState._totalFiftyCount;
                        }
                        updateConsumableBar();
                    } catch(e) {
                        showFloatingMessage('Purchase failed', '#ff4466');
                    }
                    render(); // re-render to show updated counts
                };
            });

            overlay.querySelector('#shop2-continue').onclick = () => {
                document.body.removeChild(overlay);
                updateConsumableBar();
                resolve();
            };
        };
        render();
        document.body.appendChild(overlay);
    });
}