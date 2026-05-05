/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║          CS2  BOMB DEFUSAL — MULTIPLAYER APP             ║
 * ║    React Native (Expo) + Firebase Realtime Database      ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * REQUIRED PACKAGES (run in your project root):
 *   npx expo install expo-font expo-av expo-keep-awake
 *   npm install firebase
 *
 * REQUIRED ASSETS:
 *   assets/fonts/Atwater.ttf
 *   assets/sounds/bomb_planted.mp3
 *   assets/sounds/defused.mp3
 *   assets/sounds/explosion.mp3
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  Alert,
  Vibration,
  StatusBar,
  SafeAreaView,
  ActivityIndicator,
  Animated,
  Dimensions,
  ScrollView,
  Platform,
} from 'react-native';
import { useFonts } from 'expo-font';
import { Audio } from 'expo-av';
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} from 'expo-keep-awake';
import { initializeApp, getApps } from 'firebase/app';
import {
  getDatabase,
  ref,
  set,
  get,
  onValue,
  update,
  remove,
} from 'firebase/database';

// ─────────────────────────────────────────────────────────────────────────────
// § 1 · FIREBASE CONFIGURATION
//   ▸ Go to https://console.firebase.google.com
//   ▸ Create project → Realtime Database → Start in TEST MODE
//   ▸ Copy your config object below
// ─────────────────────────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            'YOUR_API_KEY',
  authDomain:        'YOUR_PROJECT_ID.firebaseapp.com',
  databaseURL:       'https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com',
  projectId:         'YOUR_PROJECT_ID',
  storageBucket:     'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId:             'YOUR_APP_ID',
};

// Guard against Expo hot-reload re-initializing Firebase
const firebaseApp =
  getApps().length === 0
    ? initializeApp(FIREBASE_CONFIG)
    : getApps()[0];

const DB = getDatabase(firebaseApp);

// ─────────────────────────────────────────────────────────────────────────────
// § 2 · CONSTANTS & GAME CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────
const { width: SW, height: SH } = Dimensions.get('window');

// Unique session-based player ID (no Firebase Auth required)
const MY_ID = `P_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

const GAME_STATE = Object.freeze({
  LOBBY:    'LOBBY',
  PLANTING: 'PLANTING',
  PLANTED:  'PLANTED',
  DEFUSED:  'DEFUSED',
  EXPLODED: 'EXPLODED',
});

const TIMING = {
  PLANT_HOLD_SECONDS:  60,   // seconds to hold to arm the bomb
  BOMB_TIMER_SECONDS:  75,   // detonation countdown
  DEFUSE_HOLD_SECONDS:  5,   // seconds to hold to defuse
  PLANT_TICK_MS:       100,  // progress update interval
};

// CS2-inspired tactical dark palette
const C = {
  bg:           '#070707',
  surface:      '#0F0F0F',
  elevated:     '#181818',
  border:       '#232323',
  borderBright: '#383838',
  orange:       '#FF6A00',
  orangeHot:    '#FF9040',
  orangeDim:    'rgba(255,106,0,0.15)',
  red:          '#FF1E1E',
  redHot:       '#FF5050',
  redDim:       'rgba(255,30,30,0.12)',
  green:        '#00E676',
  greenDark:    'rgba(0,230,118,0.12)',
  yellow:       '#FFD600',
  white:        '#EEEEEE',
  whiteDim:     '#999999',
  gray:         '#444444',
  grayMid:      '#666666',
};

// Vibration patterns (Android-focused; iOS ignores pattern arrays)
const VIB = {
  tick:    [0, 60, 80],
  success: [0, 120, 80, 120],
  alarm:   [0, 400, 150, 400, 150, 800],
};

// ─────────────────────────────────────────────────────────────────────────────
// § 3 · UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
const genRoomCode = () =>
  Math.floor(1000 + Math.random() * 9000).toString();

const formatTime = (secs) => {
  const s = Math.max(0, Math.floor(secs));
  const mm = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// § 4 · AUDIO HOOK
//   Manages sound loading and playback. Sounds are triggered globally
//   on all devices by reacting to Firebase gameState changes.
// ─────────────────────────────────────────────────────────────────────────────
function useGameAudio() {
  const sounds = useRef({});

  // Configure audio session on mount
  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS:    false,
      playsInSilentModeIOS:  true,   // play even when iPhone is on silent
      shouldDuckAndroid:     false,
      staysActiveInBackground: true,
    });
    return () => {
      // Cleanup all loaded sounds on unmount
      Object.values(sounds.current).forEach((s) => {
        s?.unloadAsync?.().catch(() => {});
      });
    };
  }, []);

  const play = useCallback(async (key, asset) => {
    try {
      // Unload previous instance to avoid overlap
      if (sounds.current[key]) {
        await sounds.current[key].unloadAsync();
        delete sounds.current[key];
      }
      const { sound } = await Audio.Sound.createAsync(asset, {
        shouldPlay: true,
        volume: 1.0,
      });
      sounds.current[key] = sound;
    } catch (err) {
      console.warn(`[Audio] Failed to play "${key}":`, err.message);
    }
  }, []);

  const stop = useCallback(async (key) => {
    try {
      await sounds.current[key]?.stopAsync();
    } catch (_) {}
  }, []);

  const stopAll = useCallback(() => {
    Object.keys(sounds.current).forEach(stop);
  }, [stop]);

  return {
    playBombPlanted: () =>
      play('planted', require('./assets/sounds/bomb_planted.mp3')),
    playDefused: () =>
      play('defused', require('./assets/sounds/defused.mp3')),
    playExplosion: () =>
      play('explosion', require('./assets/sounds/explosion.mp3')),
    stopAll,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 5 · HOLD-BUTTON HOOK
//   Reusable hook for "hold to trigger" interactions (Plant & Defuse).
//   Returns: { progress 0-100, isHolding, pressIn, pressOut }
// ─────────────────────────────────────────────────────────────────────────────
function useHoldButton({ durationSeconds, onComplete, onRelease }) {
  const [progress, setProgress]   = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const progressRef  = useRef(0);
  const intervalRef  = useRef(null);
  const completedRef = useRef(false);

  const clear = useCallback(() => {
    clearInterval(intervalRef.current);
  }, []);

  const pressIn = useCallback(() => {
    if (completedRef.current) return;
    setIsHolding(true);
    Vibration.vibrate(VIB.tick);

    intervalRef.current = setInterval(() => {
      const increment = 100 / (durationSeconds * (1000 / TIMING.PLANT_TICK_MS));
      progressRef.current = Math.min(100, progressRef.current + increment);
      setProgress(progressRef.current);

      if (progressRef.current >= 100) {
        completedRef.current = true;
        clear();
        Vibration.cancel();
        onComplete?.();
      }
    }, TIMING.PLANT_TICK_MS);
  }, [durationSeconds, onComplete, clear]);

  const pressOut = useCallback(() => {
    if (completedRef.current) return;
    setIsHolding(false);
    clear();
    Vibration.cancel();
    // Reset progress
    progressRef.current = 0;
    setProgress(0);
    onRelease?.();
  }, [clear, onRelease]);

  const reset = useCallback(() => {
    completedRef.current = false;
    progressRef.current = 0;
    setProgress(0);
    setIsHolding(false);
    clear();
  }, [clear]);

  useEffect(() => () => clear(), [clear]);

  return { progress, isHolding, pressIn, pressOut, reset };
}

// ─────────────────────────────────────────────────────────────────────────────
// § 6 · SCREEN: HOME
// ─────────────────────────────────────────────────────────────────────────────
function HomeScreen({ onCreateRoom, onJoinRoom }) {
  const [name,   setName]   = useState('');
  const [code,   setCode]   = useState('');
  const [mode,   setMode]   = useState('menu'); // 'menu' | 'join'
  const glowVal = useRef(new Animated.Value(0)).current;

  // Animated orange glow on the logo border
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowVal, { toValue: 1, duration: 2000, useNativeDriver: false }),
        Animated.timing(glowVal, { toValue: 0, duration: 2000, useNativeDriver: false }),
      ])
    ).start();
  }, []);

  const borderColor = glowVal.interpolate({
    inputRange:  [0, 1],
    outputRange: [C.border, C.orange],
  });

  const handleCreate = () => {
    if (!name.trim()) return Alert.alert('Required', 'Enter your callsign first.');
    onCreateRoom(name.trim().toUpperCase());
  };

  const handleJoin = () => {
    if (!name.trim()) return Alert.alert('Required', 'Enter your callsign first.');
    if (code.length !== 4) return Alert.alert('Invalid Code', 'Enter the 4-digit room code.');
    onJoinRoom(code, name.trim().toUpperCase());
  };

  return (
    <SafeAreaView style={ss.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView
        contentContainerStyle={ss.homeScroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Logo Block ── */}
        <Animated.View style={[ss.logoBox, { borderColor }]}>
          <View style={ss.logoTopRow}>
            <View style={ss.logoDivLine} />
            <Text style={ss.logoEyebrow}>COUNTER-STRIKE  2</Text>
            <View style={ss.logoDivLine} />
          </View>
          <Text style={ss.logoTitle}>BOMB{'\n'}DEFUSAL</Text>
          <Text style={ss.logoTagline}>TACTICAL MULTIPLAYER  ·  FIREBASE SYNC</Text>
        </Animated.View>

        {/* ── Callsign ── */}
        <View style={ss.field}>
          <Text style={ss.fieldLabel}>CALLSIGN</Text>
          <TextInput
            style={ss.input}
            value={name}
            onChangeText={(t) => setName(t.toUpperCase())}
            placeholder="ENTER NAME"
            placeholderTextColor={C.gray}
            maxLength={12}
            autoCapitalize="characters"
          />
        </View>

        {/* ── Buttons ── */}
        {mode === 'menu' ? (
          <>
            <TouchableOpacity style={ss.btnOrange} onPress={handleCreate}>
              <Text style={ss.btnOrangeText}>⬡  CREATE ROOM</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ss.btnGhost} onPress={() => setMode('join')}>
              <Text style={ss.btnGhostText}>⬡  JOIN ROOM</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={ss.field}>
              <Text style={ss.fieldLabel}>ROOM CODE</Text>
              <TextInput
                style={[ss.input, ss.codeInput]}
                value={code}
                onChangeText={setCode}
                placeholder="_ _ _ _"
                placeholderTextColor={C.gray}
                keyboardType="number-pad"
                maxLength={4}
                textAlign="center"
              />
            </View>
            <TouchableOpacity style={ss.btnOrange} onPress={handleJoin}>
              <Text style={ss.btnOrangeText}>⬡  ENTER ROOM</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ss.btnGhost} onPress={() => setMode('menu')}>
              <Text style={ss.btnGhostText}>◀  BACK</Text>
            </TouchableOpacity>
          </>
        )}

        <Text style={ss.version}>BUILD 1.0 · REALTIME DATABASE</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § 7 · SCREEN: LOBBY
// ─────────────────────────────────────────────────────────────────────────────
function LobbyScreen({ roomCode, players, isHost, onStart, onLeave }) {
  const list      = players ? Object.values(players) : [];
  const canStart  = list.length >= 2;

  return (
    <SafeAreaView style={ss.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={ss.lobbyRoot}>

        {/* ── Room Code Card ── */}
        <View style={ss.codeCard}>
          <Text style={ss.codeLabel}>ROOM CODE</Text>
          <Text style={ss.codeValue}>{roomCode}</Text>
          <Text style={ss.codeHint}>Share with teammates to join</Text>
        </View>

        {/* ── Players ── */}
        <View style={ss.playersCard}>
          <Text style={ss.cardTitle}>OPERATORS  [{list.length}/8]</Text>
          {list.map((p, i) => (
            <View key={p.id || i} style={ss.playerRow}>
              <View style={[ss.dot, { backgroundColor: p.isHost ? C.orange : C.green }]} />
              <Text style={ss.playerName}>{p.name}</Text>
              <View style={ss.playerTags}>
                {p.isHost && <Text style={[ss.tag, { borderColor: C.orange, color: C.orange }]}>HOST</Text>}
                {p.id === MY_ID && <Text style={[ss.tag, { borderColor: C.green, color: C.green }]}>YOU</Text>}
              </View>
            </View>
          ))}
          {list.length < 2 && (
            <Text style={ss.waitMore}>Waiting for at least 1 more player…</Text>
          )}
        </View>

        {/* ── Rules ── */}
        <View style={ss.rulesCard}>
          <Text style={ss.ruleRow}>🔴  ONE player plants the bomb (hides the phone)</Text>
          <Text style={ss.ruleRow}>🔵  Others search & defuse within {TIMING.BOMB_TIMER_SECONDS}s</Text>
          <Text style={ss.ruleRow}>⚡  Hold Plant {TIMING.PLANT_HOLD_SECONDS}s · Hold Defuse {TIMING.DEFUSE_HOLD_SECONDS}s</Text>
        </View>

        {/* ── Actions ── */}
        {isHost ? (
          <TouchableOpacity
            style={[ss.btnOrange, !canStart && ss.btnDisabled]}
            onPress={canStart ? onStart : undefined}
          >
            <Text style={ss.btnOrangeText}>
              {canStart ? '▶  START MISSION' : 'NEED MORE PLAYERS'}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={ss.waitingRow}>
            <ActivityIndicator color={C.orange} size="small" />
            <Text style={ss.waitingLabel}>  WAITING FOR HOST…</Text>
          </View>
        )}

        <TouchableOpacity style={ss.btnRed} onPress={onLeave}>
          <Text style={ss.btnRedText}>✕  LEAVE ROOM</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § 8 · SCREEN: PLANTING PHASE
//   ALL devices see this screen. The person physically hiding the phone
//   holds the button. Progress is synced to Firebase every 500ms.
// ─────────────────────────────────────────────────────────────────────────────
function PlantingScreen({ roomCode, players }) {
  const [remoteProgress, setRemoteProgress] = useState(0);
  const [remotePlanting, setRemotePlanting] = useState(false);
  const fillAnim  = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const lastSyncRef = useRef(0);

  // Listen to Firebase for remote-plant progress (so all devices see the fill)
  useEffect(() => {
    const roomRef = ref(DB, `rooms/${roomCode}`);
    const unsubscribe = onValue(roomRef, (snap) => {
      const d = snap.val();
      if (!d) return;
      setRemoteProgress(d.plantProgress ?? 0);
      setRemotePlanting(d.isPlanting ?? false);
    });
    return unsubscribe;
  }, [roomCode]);

  // Animate the fill bar based on remote progress
  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue:  remoteProgress / 100,
      duration: 150,
      useNativeDriver: false,
    }).start();
  }, [remoteProgress]);

  // Pulse animation for the button
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.00, duration: 700, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  // Sync progress to Firebase (throttled to every 500ms)
  const syncToFirebase = useCallback((progress, holding) => {
    const now = Date.now();
    if (now - lastSyncRef.current < 500) return;
    lastSyncRef.current = now;
    update(ref(DB, `rooms/${roomCode}`), {
      plantProgress: progress,
      isPlanting: holding,
    }).catch(() => {});
  }, [roomCode]);

  const handleComplete = useCallback(async () => {
    // Bomb armed! Set detonation timestamp server-side.
    const detonationTimestamp = Date.now() + TIMING.BOMB_TIMER_SECONDS * 1000;
    Vibration.vibrate(VIB.success);
    await update(ref(DB, `rooms/${roomCode}`), {
      gameState:           GAME_STATE.PLANTED,
      detonationTimestamp,
      plantProgress:       100,
      isPlanting:          false,
    }).catch(console.error);
  }, [roomCode]);

  const handleRelease = useCallback(() => {
    update(ref(DB, `rooms/${roomCode}`), {
      plantProgress: 0,
      isPlanting:    false,
    }).catch(() => {});
  }, [roomCode]);

  const { progress, isHolding, pressIn, pressOut } = useHoldButton({
    durationSeconds: TIMING.PLANT_HOLD_SECONDS,
    onComplete: handleComplete,
    onRelease:  handleRelease,
  });

  // When this device is holding, push local progress; otherwise show remote
  const displayProgress = isHolding ? progress : remoteProgress;

  useEffect(() => {
    if (isHolding) syncToFirebase(progress, true);
  }, [isHolding, progress, syncToFirebase]);

  const fillColor = fillAnim.interpolate({
    inputRange:  [0, 0.5, 1],
    outputRange: [C.orange, C.orangeHot, C.red],
  });
  const fillWidth = fillAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0%', '100%'],
  });

  const playerList = players ? Object.values(players) : [];

  return (
    <SafeAreaView style={ss.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={ss.gameRoot}>

        <Text style={ss.phaseTag}>⚠  PLANTING PHASE</Text>
        <Text style={ss.phaseNote}>
          The BOMBER hides the phone and arms it.{'\n'}
          All others wait for the {TIMING.BOMB_TIMER_SECONDS}s hunt.
        </Text>

        {/* Progress Bar */}
        <View style={ss.barTrack}>
          <Animated.View
            style={[ss.barFill, { width: fillWidth, backgroundColor: fillColor }]}
          />
        </View>
        <Text style={ss.barLabel}>
          {Math.floor(displayProgress)}%
          {'  '}
          {isHolding
            ? '— ARMING…'
            : remotePlanting
            ? '— TEAMMATE ARMING…'
            : '— HOLD TO ARM'}
        </Text>

        {/* Big Plant Button */}
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={[ss.bigBtn, isHolding && ss.bigBtnActive]}
            onPressIn={pressIn}
            onPressOut={pressOut}
            activeOpacity={0.85}
          >
            <Text style={ss.bigBtnIcon}>💣</Text>
            <Text style={ss.bigBtnLabel}>
              {isHolding
                ? `ARMING  ${Math.floor(displayProgress)}%`
                : `HOLD  ${TIMING.PLANT_HOLD_SECONDS}S\nTO PLANT`}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Player Roster */}
        <View style={ss.roster}>
          {playerList.map((p, i) => (
            <Text key={i} style={ss.rosterPlayer}>
              ▸ {p.name}
            </Text>
          ))}
        </View>

        <Text style={ss.footnote}>
          Release at any point to abort arming
        </Text>
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § 9 · SCREEN: PLANTED / COUNTDOWN + DEFUSE
//   ALL devices show the synchronized countdown. The person who FINDS the
//   phone holds "Defuse" for 5 seconds. If time hits 0, all explode.
// ─────────────────────────────────────────────────────────────────────────────
function PlantedScreen({ roomCode, detonationTimestamp }) {
  const [timeLeft,    setTimeLeft]    = useState(TIMING.BOMB_TIMER_SECONDS);
  const [defProgress, setDefProgress] = useState(0);
  const defFillAnim  = useRef(new Animated.Value(0)).current;
  const urgencyAnim  = useRef(new Animated.Value(1)).current;
  const timerRef     = useRef(null);
  const urgencyRef   = useRef(null);

  // ── Server-synced countdown ──────────────────────────────────
  useEffect(() => {
    const tick = () => {
      const remaining = (detonationTimestamp - Date.now()) / 1000;
      setTimeLeft(Math.max(0, remaining));
      if (remaining <= 0) {
        clearInterval(timerRef.current);
        // Trigger explosion in Firebase (only one device needs to, race-condition safe)
        update(ref(DB, `rooms/${roomCode}`), {
          gameState: GAME_STATE.EXPLODED,
        }).catch(() => {});
      }
    };
    tick();
    timerRef.current = setInterval(tick, 200); // 5fps is enough for smooth countdown
    return () => clearInterval(timerRef.current);
  }, [detonationTimestamp, roomCode]);

  // ── Urgency pulse when ≤ 15 seconds ─────────────────────────
  useEffect(() => {
    if (timeLeft > 15) return;
    const speed = Math.max(120, timeLeft * 50);
    urgencyRef.current?.stop?.();
    urgencyRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(urgencyAnim, { toValue: 1.04, duration: speed, useNativeDriver: true }),
        Animated.timing(urgencyAnim, { toValue: 1.00, duration: speed, useNativeDriver: true }),
      ])
    );
    urgencyRef.current.start();
    return () => urgencyRef.current?.stop?.();
  }, [Math.floor(timeLeft)]);

  // ── Defuse hold button ───────────────────────────────────────
  const handleDefuseComplete = useCallback(async () => {
    clearInterval(timerRef.current);
    Vibration.vibrate(VIB.success);
    await update(ref(DB, `rooms/${roomCode}`), {
      gameState: GAME_STATE.DEFUSED,
    }).catch(console.error);
  }, [roomCode]);

  const handleDefuseRelease = useCallback(() => {
    Animated.timing(defFillAnim, { toValue: 0, duration: 300, useNativeDriver: false }).start();
  }, [defFillAnim]);

  const { progress: defProg, isHolding: isDefusing, pressIn, pressOut } = useHoldButton({
    durationSeconds: TIMING.DEFUSE_HOLD_SECONDS,
    onComplete: handleDefuseComplete,
    onRelease:  handleDefuseRelease,
  });

  // Animate defuse fill bar
  useEffect(() => {
    Animated.timing(defFillAnim, {
      toValue:  defProg / 100,
      duration: 80,
      useNativeDriver: false,
    }).start();
    setDefProgress(defProg);
  }, [defProg]);

  const isCritical = timeLeft <= 15;
  const timerColor = timeLeft <= 10 ? C.red : isCritical ? C.yellow : C.orange;

  const defFillWidth = defFillAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <SafeAreaView style={[ss.safe, isCritical && { backgroundColor: '#0E0000' }]}>
      <StatusBar barStyle="light-content" backgroundColor={isCritical ? '#0E0000' : C.bg} />
      <View style={ss.gameRoot}>

        <Text style={[ss.phaseTag, { color: C.red }]}>☢  BOMB PLANTED</Text>

        {/* ── Main Countdown ── */}
        <Animated.Text
          style={[
            ss.countdown,
            { color: timerColor },
            isCritical && { transform: [{ scale: urgencyAnim }] },
          ]}
        >
          {formatTime(timeLeft)}
        </Animated.Text>

        {isCritical && (
          <Text style={ss.criticalWarning}>
            ⚠  CRITICAL — DEFUSE IMMEDIATELY  ⚠
          </Text>
        )}

        {/* ── Defuse Progress Bar ── */}
        <View style={ss.barTrack}>
          <Animated.View
            style={[ss.barFill, { width: defFillWidth, backgroundColor: C.green }]}
          />
        </View>
        <Text style={ss.barLabel}>
          {isDefusing
            ? `DEFUSING…  ${Math.floor(defProgress)}%`
            : `HOLD ${TIMING.DEFUSE_HOLD_SECONDS}S TO DEFUSE · RELEASE = ABORT`}
        </Text>

        {/* ── Defuse Button ── */}
        <TouchableOpacity
          style={[ss.defuseBtn, isDefusing && ss.defuseBtnActive]}
          onPressIn={pressIn}
          onPressOut={pressOut}
          activeOpacity={0.85}
        >
          <Text style={ss.bigBtnIcon}>🔧</Text>
          <Text style={[ss.bigBtnLabel, { color: isDefusing ? C.green : C.white }]}>
            {isDefusing
              ? `${Math.floor(defProgress)}%\nDEFUSING…`
              : `HOLD TO\nDEFUSE`}
          </Text>
        </TouchableOpacity>

        <Text style={ss.footnote}>
          Find the bomb · Hold for {TIMING.DEFUSE_HOLD_SECONDS}s · Don't let go!
        </Text>
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § 10 · SCREEN: RESULT (DEFUSED / EXPLODED)
// ─────────────────────────────────────────────────────────────────────────────
function ResultScreen({ result, onPlayAgain, onLeave }) {
  const scaleAnim   = useRef(new Animated.Value(0.6)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1, tension: 50, friction: 7, useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1, duration: 500, useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const isDefused = result === GAME_STATE.DEFUSED;
  const accent    = isDefused ? C.green : C.red;
  const bgColor   = isDefused ? '#001508' : '#0F0000';

  return (
    <SafeAreaView style={[ss.safe, { backgroundColor: bgColor }]}>
      <StatusBar barStyle="light-content" />
      <View style={ss.resultRoot}>
        <Animated.View
          style={[
            ss.resultCard,
            { borderColor: accent, opacity: opacityAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          <Text style={ss.resultIcon}>{isDefused ? '🛡' : '💥'}</Text>

          <Text style={[ss.resultHeadline, { color: accent }]}>
            {isDefused ? 'BOMB DEFUSED' : 'DETONATION'}
          </Text>
          <Text style={[ss.resultSubline, { color: accent }]}>
            {isDefused ? 'COUNTER‑TERRORISTS WIN' : 'TERRORISTS WIN'}
          </Text>

          <View style={[ss.resultRule, { backgroundColor: accent }]} />

          <Text style={ss.resultBody}>
            {isDefused
              ? 'Device neutralized. Outstanding work, operator.\nThe site is secure.'
              : 'The bomb detonated.\nAll hope was lost. Better luck next round.'}
          </Text>
        </Animated.View>

        <TouchableOpacity style={ss.btnOrange} onPress={onPlayAgain}>
          <Text style={ss.btnOrangeText}>↺  PLAY AGAIN</Text>
        </TouchableOpacity>
        <TouchableOpacity style={ss.btnGhost} onPress={onLeave}>
          <Text style={ss.btnGhostText}>✕  MAIN MENU</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// § 11 · ROOT APP COMPONENT
//   Central state machine. Owns Firebase room subscription and reacts
//   to gameState changes by switching screens and triggering audio/haptics.
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen,   setScreen]   = useState('HOME');   // HOME|LOBBY|GAME|RESULT
  const [loading,  setLoading]  = useState(false);
  const [roomCode, setRoomCode] = useState(null);
  const [isHost,   setIsHost]   = useState(false);
  const [myName,   setMyName]   = useState('');
  const [roomData, setRoomData] = useState(null);

  const prevStateRef = useRef(null);
  const audio = useGameAudio();

  // ── Load custom ATWATER font ─────────────────────────────────
  const [fontsLoaded, fontError] = useFonts({
    Atwater: require('./assets/fonts/Atwater.ttf'),
  });

  // ── Firebase room listener ───────────────────────────────────
  useEffect(() => {
    if (!roomCode) return;

    const roomRef = ref(DB, `rooms/${roomCode}`);
    const unsubscribe = onValue(roomRef, (snap) => {
      const data = snap.val();

      if (!data) {
        // Room deleted (host left)
        Alert.alert('Room Closed', 'The host closed the room.');
        handleFullReset();
        return;
      }

      setRoomData(data);

      // React to gameState transitions
      const next = data.gameState;
      const prev = prevStateRef.current;

      if (next !== prev) {
        prevStateRef.current = next;
        onGameStateChange(next);
      }
    });

    return unsubscribe; // Firebase v9 onValue returns its own unsubscribe fn
  }, [roomCode]);

  const onGameStateChange = async (state) => {
    switch (state) {
      case GAME_STATE.PLANTING:
        await activateKeepAwakeAsync();
        setScreen('GAME');
        break;

      case GAME_STATE.PLANTED:
        await activateKeepAwakeAsync();
        audio.playBombPlanted();
        Vibration.vibrate(VIB.tick);
        setScreen('GAME');
        break;

      case GAME_STATE.DEFUSED:
        deactivateKeepAwake();
        audio.stopAll();
        audio.playDefused();
        Vibration.vibrate(VIB.success);
        setScreen('RESULT');
        break;

      case GAME_STATE.EXPLODED:
        deactivateKeepAwake();
        audio.stopAll();
        audio.playExplosion();
        Vibration.vibrate(VIB.alarm);
        setScreen('RESULT');
        break;

      case GAME_STATE.LOBBY:
        deactivateKeepAwake();
        audio.stopAll();
        setScreen('LOBBY');
        break;
    }
  };

  const handleFullReset = () => {
    deactivateKeepAwake();
    audio.stopAll();
    setRoomCode(null);
    setRoomData(null);
    setIsHost(false);
    setMyName('');
    setScreen('HOME');
    prevStateRef.current = null;
  };

  // ── CREATE ROOM ──────────────────────────────────────────────
  const createRoom = async (name) => {
    setLoading(true);
    setMyName(name);
    const code = genRoomCode();

    try {
      await set(ref(DB, `rooms/${code}`), {
        gameState:           GAME_STATE.LOBBY,
        hostId:              MY_ID,
        createdAt:           Date.now(),
        plantProgress:       0,
        isPlanting:          false,
        detonationTimestamp: null,
        players: {
          [MY_ID]: { id: MY_ID, name, isHost: true },
        },
      });
      setRoomCode(code);
      setIsHost(true);
      prevStateRef.current = GAME_STATE.LOBBY;
      setScreen('LOBBY');
    } catch (err) {
      Alert.alert('Firebase Error', `Could not create room.\n${err.message}\n\nCheck your FIREBASE_CONFIG.`);
    } finally {
      setLoading(false);
    }
  };

  // ── JOIN ROOM ────────────────────────────────────────────────
  const joinRoom = async (code, name) => {
    setLoading(true);
    setMyName(name);

    try {
      const snap = await get(ref(DB, `rooms/${code}`));
      if (!snap.exists()) {
        Alert.alert('Not Found', `Room "${code}" does not exist.`);
        setLoading(false);
        return;
      }
      const data = snap.val();
      if (data.gameState !== GAME_STATE.LOBBY) {
        Alert.alert('In Progress', 'That room has already started. Wait for next round.');
        setLoading(false);
        return;
      }
      await update(ref(DB, `rooms/${code}/players/${MY_ID}`), {
        id:     MY_ID,
        name,
        isHost: false,
      });
      setRoomCode(code);
      setIsHost(false);
      prevStateRef.current = GAME_STATE.LOBBY;
      setScreen('LOBBY');
    } catch (err) {
      Alert.alert('Join Error', `Failed to join room.\n${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── START GAME ───────────────────────────────────────────────
  const startGame = async () => {
    await update(ref(DB, `rooms/${roomCode}`), {
      gameState:           GAME_STATE.PLANTING,
      plantProgress:       0,
      isPlanting:          false,
      detonationTimestamp: null,
    }).catch(console.error);
  };

  // ── LEAVE / RESET ────────────────────────────────────────────
  const leaveRoom = async () => {
    if (roomCode) {
      try {
        await remove(ref(DB, `rooms/${roomCode}/players/${MY_ID}`));
        if (isHost) {
          // Host leaving nukes the whole room
          await remove(ref(DB, `rooms/${roomCode}`));
        }
      } catch (_) {}
    }
    handleFullReset();
  };

  // ── PLAY AGAIN (host resets state to LOBBY) ──────────────────
  const playAgain = async () => {
    if (isHost && roomCode) {
      await update(ref(DB, `rooms/${roomCode}`), {
        gameState:           GAME_STATE.LOBBY,
        plantProgress:       0,
        isPlanting:          false,
        detonationTimestamp: null,
      }).catch(console.error);
      // onGameStateChange will fire via listener
    } else {
      // Non-host just goes back to lobby view; host controls restart
      setScreen('LOBBY');
    }
  };

  // ── Loading / Font Splash ────────────────────────────────────
  if (!fontsLoaded && !fontError) {
    return (
      <View style={ss.splash}>
        <ActivityIndicator color={C.orange} size="large" />
        <Text style={ss.splashText}>LOADING ASSETS…</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={ss.splash}>
        <ActivityIndicator color={C.orange} size="large" />
        <Text style={ss.splashText}>CONNECTING…</Text>
      </View>
    );
  }

  // ── Screen Router ────────────────────────────────────────────
  switch (screen) {
    case 'HOME':
      return <HomeScreen onCreateRoom={createRoom} onJoinRoom={joinRoom} />;

    case 'LOBBY':
      return (
        <LobbyScreen
          roomCode={roomCode}
          players={roomData?.players}
          isHost={isHost}
          onStart={startGame}
          onLeave={leaveRoom}
        />
      );

    case 'GAME': {
      const gs = roomData?.gameState;

      if (gs === GAME_STATE.PLANTING) {
        return (
          <PlantingScreen
            roomCode={roomCode}
            players={roomData?.players}
          />
        );
      }

      if (gs === GAME_STATE.PLANTED) {
        return (
          <PlantedScreen
            roomCode={roomCode}
            detonationTimestamp={roomData?.detonationTimestamp}
          />
        );
      }

      // Transitioning…
      return (
        <View style={ss.splash}>
          <ActivityIndicator color={C.orange} />
          <Text style={ss.splashText}>SYNCING…</Text>
        </View>
      );
    }

    case 'RESULT':
      return (
        <ResultScreen
          result={roomData?.gameState}
          onPlayAgain={playAgain}
          onLeave={leaveRoom}
        />
      );

    default:
      return <HomeScreen onCreateRoom={createRoom} onJoinRoom={joinRoom} />;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// § 12 · STYLES
//   All text uses the "Atwater" font for that CS2 tactical aesthetic.
// ─────────────────────────────────────────────────────────────────────────────
const F = 'Atwater'; // shorthand for fontFamily

const ss = StyleSheet.create({

  // ── Structural ──────────────────────────────────────────────
  safe: {
    flex: 1,
    backgroundColor: C.bg,
  },
  splash: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashText: {
    fontFamily: F,
    color: C.orange,
    fontSize: 14,
    letterSpacing: 6,
    marginTop: 20,
  },

  // ── Home ─────────────────────────────────────────────────────
  homeScroll: {
    padding: 24,
    paddingTop: 48,
    alignItems: 'center',
    minHeight: SH,
  },
  logoBox: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 2,
    backgroundColor: C.surface,
    padding: 28,
    alignItems: 'center',
    marginBottom: 36,
  },
  logoTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  logoDivLine: {
    flex: 1,
    height: 1,
    backgroundColor: C.border,
  },
  logoEyebrow: {
    fontFamily: F,
    color: C.orange,
    fontSize: 10,
    letterSpacing: 8,
    marginHorizontal: 10,
  },
  logoTitle: {
    fontFamily: F,
    color: C.white,
    fontSize: 56,
    letterSpacing: 8,
    textAlign: 'center',
    lineHeight: 60,
  },
  logoTagline: {
    fontFamily: F,
    color: C.grayMid,
    fontSize: 10,
    letterSpacing: 4,
    marginTop: 12,
  },
  field: {
    width: '100%',
    marginBottom: 16,
  },
  fieldLabel: {
    fontFamily: F,
    color: C.grayMid,
    fontSize: 11,
    letterSpacing: 5,
    marginBottom: 6,
  },
  input: {
    fontFamily: F,
    backgroundColor: C.elevated,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 2,
    color: C.white,
    fontSize: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    letterSpacing: 2,
  },
  codeInput: {
    fontSize: 36,
    letterSpacing: 16,
    textAlign: 'center',
  },
  btnOrange: {
    backgroundColor: C.orange,
    borderRadius: 2,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
  },
  btnOrangeText: {
    fontFamily: F,
    color: C.bg,
    fontSize: 15,
    letterSpacing: 5,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.borderBright,
    borderRadius: 2,
    paddingVertical: 14,
    alignItems: 'center',
    width: '100%',
    marginBottom: 12,
  },
  btnGhostText: {
    fontFamily: F,
    color: C.whiteDim,
    fontSize: 13,
    letterSpacing: 5,
  },
  btnRed: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.red,
    borderRadius: 2,
    paddingVertical: 14,
    alignItems: 'center',
    width: '100%',
    marginTop: 8,
  },
  btnRedText: {
    fontFamily: F,
    color: C.red,
    fontSize: 13,
    letterSpacing: 5,
  },
  btnDisabled: { opacity: 0.35 },
  version: {
    fontFamily: F,
    color: C.gray,
    fontSize: 10,
    letterSpacing: 4,
    marginTop: 40,
  },

  // ── Lobby ────────────────────────────────────────────────────
  lobbyRoot: {
    flex: 1,
    padding: 20,
  },
  codeCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.orange,
    borderRadius: 2,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  codeLabel: {
    fontFamily: F,
    color: C.orange,
    fontSize: 10,
    letterSpacing: 8,
    marginBottom: 6,
  },
  codeValue: {
    fontFamily: F,
    color: C.white,
    fontSize: 72,
    letterSpacing: 18,
  },
  codeHint: {
    fontFamily: F,
    color: C.grayMid,
    fontSize: 11,
    letterSpacing: 2,
    marginTop: 4,
  },
  playersCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 2,
    padding: 16,
    marginBottom: 12,
    flex: 1,
  },
  cardTitle: {
    fontFamily: F,
    color: C.orange,
    fontSize: 11,
    letterSpacing: 5,
    marginBottom: 10,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 10,
  },
  playerName: {
    fontFamily: F,
    color: C.white,
    fontSize: 16,
    letterSpacing: 2,
    flex: 1,
  },
  playerTags: {
    flexDirection: 'row',
    gap: 4,
  },
  tag: {
    fontFamily: F,
    fontSize: 9,
    letterSpacing: 2,
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 1,
  },
  waitMore: {
    fontFamily: F,
    color: C.grayMid,
    fontSize: 11,
    letterSpacing: 2,
    marginTop: 10,
    textAlign: 'center',
  },
  rulesCard: {
    backgroundColor: C.elevated,
    borderRadius: 2,
    padding: 12,
    marginBottom: 16,
  },
  ruleRow: {
    fontFamily: F,
    color: C.whiteDim,
    fontSize: 11,
    letterSpacing: 1,
    marginBottom: 5,
    lineHeight: 18,
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    marginBottom: 12,
  },
  waitingLabel: {
    fontFamily: F,
    color: C.grayMid,
    fontSize: 13,
    letterSpacing: 4,
  },

  // ── Game (shared) ────────────────────────────────────────────
  gameRoot: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phaseTag: {
    fontFamily: F,
    color: C.orange,
    fontSize: 16,
    letterSpacing: 6,
    marginBottom: 6,
  },
  phaseNote: {
    fontFamily: F,
    color: C.grayMid,
    fontSize: 12,
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 20,
  },
  barTrack: {
    width: '100%',
    height: 6,
    backgroundColor: C.elevated,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  barLabel: {
    fontFamily: F,
    color: C.grayMid,
    fontSize: 11,
    letterSpacing: 2,
    marginBottom: 24,
    alignSelf: 'flex-start',
  },
  bigBtn: {
    width: SW * 0.55,
    height: SW * 0.55,
    borderRadius: (SW * 0.55) / 2,
    backgroundColor: C.elevated,
    borderWidth: 2,
    borderColor: C.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 16,
    // Subtle glow shadow
    shadowColor: C.orange,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  bigBtnActive: {
    borderColor: C.red,
    backgroundColor: '#1A0000',
    shadowColor: C.red,
  },
  bigBtnIcon: {
    fontSize: 44,
    marginBottom: 8,
  },
  bigBtnLabel: {
    fontFamily: F,
    color: C.white,
    fontSize: 15,
    letterSpacing: 3,
    textAlign: 'center',
    lineHeight: 22,
  },
  roster: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 12,
  },
  rosterPlayer: {
    fontFamily: F,
    color: C.grayMid,
    fontSize: 11,
    letterSpacing: 2,
    marginHorizontal: 6,
    marginVertical: 2,
  },
  footnote: {
    fontFamily: F,
    color: C.gray,
    fontSize: 11,
    letterSpacing: 2,
    marginTop: 16,
    textAlign: 'center',
  },

  // ── Planted Countdown ────────────────────────────────────────
  countdown: {
    fontFamily: F,
    fontSize: 90,
    letterSpacing: 6,
    marginVertical: 4,
    // Glow effect
    textShadowColor: 'rgba(255,106,0,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 24,
  },
  criticalWarning: {
    fontFamily: F,
    color: C.red,
    fontSize: 13,
    letterSpacing: 3,
    marginBottom: 12,
    textAlign: 'center',
  },
  defuseBtn: {
    width: SW * 0.5,
    height: SW * 0.5,
    borderRadius: (SW * 0.5) / 2,
    backgroundColor: C.elevated,
    borderWidth: 2,
    borderColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 16,
    shadowColor: C.green,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  defuseBtnActive: {
    backgroundColor: C.greenDark,
    shadowOpacity: 0.6,
  },

  // ── Result ───────────────────────────────────────────────────
  resultRoot: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultCard: {
    width: '100%',
    backgroundColor: C.surface,
    borderWidth: 2,
    borderRadius: 2,
    padding: 32,
    alignItems: 'center',
    marginBottom: 28,
  },
  resultIcon: {
    fontSize: 72,
    marginBottom: 16,
  },
  resultHeadline: {
    fontFamily: F,
    fontSize: 34,
    letterSpacing: 5,
    textAlign: 'center',
  },
  resultSubline: {
    fontFamily: F,
    fontSize: 13,
    letterSpacing: 5,
    marginTop: 4,
    textAlign: 'center',
  },
  resultRule: {
    width: '50%',
    height: 1,
    marginVertical: 20,
  },
  resultBody: {
    fontFamily: F,
    color: C.whiteDim,
    fontSize: 13,
    letterSpacing: 2,
    textAlign: 'center',
    lineHeight: 22,
  },
});
