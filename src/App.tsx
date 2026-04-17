import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Clock, CheckCircle2, PlayCircle, Calendar, Settings, Upload, MapPin, ChevronDown, ChevronUp, Database, Trash2, Edit3, Wifi, WifiOff } from 'lucide-react';
import * as XLSX from 'xlsx';
import { db } from './firebase';
import { ref, onValue, set, remove, goOnline, goOffline } from 'firebase/database';
import { motion, AnimatePresence } from 'motion/react';

// ── 상수 정의 ──
const ROOMS = [
  { key: '어울림실', label: '어울림실', floor: 'B1',    color: '#4f8ef7', keywords: ['어울림실'] },
  { key: '청춘나래', label: '청춘나래', floor: 'F3 왼', color: '#00d68f', keywords: ['청춘나래'] },
  { key: '청춘누리', label: '청춘누리', floor: 'F3 오', color: '#ff7043', keywords: ['청춘누리'] },
  { key: '청춘마루', label: '청춘마루', floor: 'F4',    color: '#ffd740', keywords: ['청춘마루'] }
];

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_LIST = ['월', '화', '수', '목', '금'];
const DAY_CLR: Record<string, string> = { '월': '#4f8ef7', '화': '#00d68f', '수': '#ffd740', '목': '#ff7043', '금': '#b084f7' };

interface ScheduleItem {
  day: string;
  start: string;
  end: string;
  name: string;
}

interface ManualOverride {
  active: boolean;
  name: string;
  start: string;
  end: string;
  updatedAt: number;
}

type TabType = 'dashboard' | 'manual' | 'upload' | 'check';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [scheduleData, setScheduleData] = useState<Record<string, ScheduleItem[]>>({});
  const [manualOv, setManualOv] = useState<Record<string, ManualOverride>>({});
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isConnected, setIsConnected] = useState(false);
  
  // 업로드 상태
  const [uploadStatus, setUploadStatus] = useState<{ message: string; type: 'success' | 'error' | 'loading' | '' }>({ message: '', type: '' });
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 수동 제어 입력 상태 (방별로 관리)
  const [manualInputs, setManualInputs] = useState<Record<string, { name: string, start: string, end: string }>>(
    Object.fromEntries(ROOMS.map(r => [r.key, { name: '', start: '', end: '' }]))
  );

  // 1. 실시간 데이터 구독
  useEffect(() => {
    const connectedRef = ref(db, '.info/connected');
    const scheduleRef = ref(db, 'welfareSchedule');
    const manualRef = ref(db, 'manualOverride');

    const unsubConn = onValue(connectedRef, (snap) => setIsConnected(snap.val() === true));
    const unsubSched = onValue(scheduleRef, (snap) => setScheduleData(snap.val() || {}));
    const unsubManual = onValue(manualRef, (snap) => setManualOv(snap.val() || {}));

    const timer = setInterval(() => setCurrentTime(new Date()), 1000);

    return () => {
      unsubConn();
      unsubSched();
      unsubManual();
      clearInterval(timer);
    };
  }, []);

  // 2. 시간 계산 유틸
  const pad = (n: number) => String(n).padStart(2, '0');
  const toMin = (t: string) => {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const normTime = (t: string) => {
    const clean = t.replace('\uff1a', ':').trim();
    const parts = clean.split(':').map(Number);
    return pad(parts[0]) + ':' + pad(parts[1]);
  };

  const currentDayLabel = DAYS[currentTime.getDay()];
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

  // 3. 실시간 현황 계산
  const roomStatusList = useMemo(() => {
    return ROOMS.map(room => {
      const man = manualOv[room.key];
      const isManualActive = !!(man && man.active);
      const progs = scheduleData[room.key] || [];
      const todayProgs = progs.filter(p => p.day === currentDayLabel);
      
      const autoProg = todayProgs.find(p => currentMinutes >= toMin(p.start) && currentMinutes < toMin(p.end));
      const nextProg = todayProgs
        .filter(p => toMin(p.start) > currentMinutes)
        .sort((a, b) => toMin(a.start) - toMin(b.start))[0];

      const active = isManualActive ? man : autoProg;

      return {
        ...room,
        isManualActive,
        active,
        nextProg,
        todayCount: todayProgs.length
      };
    });
  }, [currentTime, scheduleData, manualOv, currentDayLabel, currentMinutes]);

  // 4. 수동 제어 핸들러
  const handleManualInput = (key: string, field: string, value: string) => {
    setManualInputs(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value }
    }));
  };

  const applyManual = (key: string) => {
    const input = manualInputs[key];
    if (!input.name.trim()) {
      alert("프로그램명을 입력해주세요.");
      return;
    }
    const data: ManualOverride = {
      active: true,
      name: input.name.trim(),
      start: input.start || '',
      end: input.end || '',
      updatedAt: Date.now()
    };
    set(ref(db, `manualOverride/${key}`), data)
      .then(() => {
        alert(`[${key}] 수동 설정이 적용되었습니다.`);
      })
      .catch(err => alert("오류 발생: " + err.message));
  };

  const clearManual = (key: string) => {
    remove(ref(db, `manualOverride/${key}`))
      .then(() => {
        setManualInputs(prev => ({
          ...prev,
          [key]: { name: '', start: '', end: '' }
        }));
      });
  };

  const clearAllManual = () => {
    if (!confirm('모든 수동 설정을 해제하시겠습니까?')) return;
    remove(ref(db, 'manualOverride'));
  };

  // 5. 엑셀 업로드
  const handleUpload = () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      alert("파일을 선택해주세요!");
      return;
    }

    setIsUploading(true);
    setUploadStatus({ message: "⏳ 엑셀 파일 분석 중...", type: "loading" });

    const reader = new FileReader();
    reader.onload = (e) => {
      setTimeout(() => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const ws = workbook.Sheets[workbook.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as any[][];
          
          const parsed = parseExcel(raw, ws);
          let totalCount = 0;
          ROOMS.forEach(r => totalCount += (parsed[r.key] || []).length);

          if (totalCount === 0) {
            throw new Error("분석된 프로그램이 없습니다. 서식을 확인해주세요.");
          }

          setUploadStatus({ message: "🚀 클라우드 동기화 중...", type: "loading" });
          set(ref(db, 'welfareSchedule'), parsed)
            .then(() => {
              setUploadStatus({ message: `✅ 동기화 완료! ${totalCount}개 데이터가 반영되었습니다.`, type: "success" });
              setIsUploading(false);
            })
            .catch(err => {
              setUploadStatus({ message: "❌ 업로드 실패: " + err.message, type: "error" });
              setIsUploading(false);
            });
        } catch (err: any) {
          setUploadStatus({ message: "❌ 분석 오류: " + err.message, type: "error" });
          setIsUploading(false);
        }
      }, 200);
    };
    reader.readAsArrayBuffer(file);
  };

  const parseExcel = (data: any[][], ws: XLSX.WorkSheet) => {
    const res: Record<string, ScheduleItem[]> = {};
    ROOMS.forEach(r => res[r.key] = []);

    // 병합셀 확장용 임시 데이터
    const md = data.map(r => r ? [...r] : []);
    if (ws['!merges']) {
      ws['!merges'].forEach(m => {
        const rs = m.s.r, re = m.e.r, cs = m.s.c, ce = m.e.c;
        const topVal = (data[rs] && data[rs][cs] !== undefined) ? data[rs][cs] : null;
        for (let r = rs; r <= re; r++) {
          for (let c = cs; c <= ce; c++) {
            if (!md[r]) md[r] = [];
            if (md[r][c] == null) md[r][c] = topVal;
          }
        }
      });
    }

    // 헤더 탐색
    let dayR = -1, roomR = -1;
    for (let i = 0; i < Math.min(data.length, 15); i++) {
      const fc = String((data[i] || [])[0] || '').trim();
      if (fc === '요일') dayR = i;
      if (fc === '구분') roomR = i;
    }

    if (dayR < 0 || roomR < 0) throw new Error("'요일' 또는 '구분' 행을 찾을 수 없습니다.");

    const mdDay = md[dayR] || [];
    const mdRoom = md[roomR] || [];

    // 방 매핑
    const rmap: Record<number, string> = {};
    mdRoom.forEach((cell, idx) => {
      const raw = String(cell || '').replace(/\n/g, '').replace(/\//g, '').replace(/\s+/g, '');
      ROOMS.forEach(r => {
        if (r.keywords.some(kw => raw.indexOf(kw) >= 0)) rmap[idx] = r.key;
      });
    });

    // 데이터 추출
    let cS = '', cE = '';
    const TIME_PAT = /\d{1,2}[:\uff1a]\d{2}\s*[-~]\s*\d{1,2}[:\uff1a]\d{2}/;

    for (let ri = roomR + 1; ri < data.length; ri++) {
      const row = data[ri] || [];
      const fc2 = String(row[0] || '').trim();
      const tm = fc2.match(/(\d{1,2}[:\uff1a]\d{2})\s*[-~]\s*(\d{1,2}[:\uff1a]\d{2})/);
      
      if (tm) {
        cS = normTime(tm[1]);
        cE = normTime(tm[2]);
      }
      if (!cS) continue;

      for (let ci = 1; ci < row.length; ci++) {
        const cv = row[ci];
        if (cv == null || String(cv).trim() === '') continue;
        const cs = String(cv).trim();
        // 👉 [핵심 수정 부분] 쓰레기 데이터 걸러내기
        if (/^\d+$/.test(cs) || /^\d+월$/.test(cs) || cs === '개') continue;
        // '정원', '16석', '20명' 등의 좌석/인원수 관련 단어 무시
        if (cs === '정원' || /^\d+석$/.test(cs) || /^\d+명$/.test(cs)) continue;
        if (cs.indexOf('예정') >= 0 || cs.indexOf('특강') >= 0) continue;

        const fd = (mdDay[ci] != null) ? String(mdDay[ci]).trim() : null;
        if (!fd || DAY_LIST.indexOf(fd) < 0) continue;
        const rk = rmap[ci];
        if (!rk) continue;

        let fs = cS, fe = cE;
        const inner = cs.match(/(\d{1,2}[:\uff1a]\d{2})\s*[-~]\s*(\d{1,2}[:\uff1a]\d{2})/);
        if (inner) {
          fs = normTime(inner[1]);
          fe = normTime(inner[2]);
        }

        const pn = cs.replace(/(\d{1,2}[:\uff1a]\d{2})\s*[-~]\s*(\d{1,2}[:\uff1a]\d{2})/g, '')
          .replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
        if (!pn) continue;

        const isDup = res[rk].some(p => p.day === fd && p.start === fs && p.name === pn);
        if (!isDup) res[rk].push({ day: fd, start: fs, end: fe, name: pn });
      }
    }
    return res;
  };

  const clearAllSchedule = () => {
    if (!confirm('저장된 시간표를 모두 삭제하시겠습니까?')) return;
    remove(ref(db, 'welfareSchedule'))
      .then(() => setUploadStatus({ message: "🗑 시간표가 초기화되었습니다.", type: "success" }));
  };

  return (
    <div className="min-h-screen bg-bg text-[#e8eaf6] p-5 md:p-10 font-sans selection:bg-accent selection:text-white">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* ── Header ── */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-white/5 pb-6">
          <div className="space-y-1">
            <h1 className="font-display text-5xl tracking-wider text-white">YEOHNEE CARE</h1>
            <p className="text-xs font-bold text-text-dim tracking-[0.2em] uppercase">Program Room Status Board</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div id="clock-time" className="font-display text-5xl text-accent tracking-[0.1em] tabular-nums">
              {currentTime.toLocaleTimeString('ko-KR', { hour12: false })}
            </div>
            <div className="text-sm font-bold text-text-dim">
              {currentTime.getFullYear()}.{pad(currentTime.getMonth() + 1)}.{pad(currentTime.getDate())} ({currentDayLabel}요일)
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green animate-pulse shadow-[0_0_8px_rgba(0,214,143,0.5)]' : 'bg-red'}`} />
              <span className="text-[10px] font-black tracking-widest uppercase opacity-60">
                {isConnected ? 'Realtime Connected' : 'Sync Disconnected'}
              </span>
            </div>
          </div>
        </header>

        {/* ── Tabs ── */}
        <div className="flex p-1 bg-surface rounded-2xl w-fit shadow-2xl border border-white/5">
          {[
            { id: 'dashboard', label: '📺 실시간 현황' },
            { id: 'manual', label: '🎛 수동 제어' },
            { id: 'upload', label: '📤 시간표 업로드' },
            { id: 'check', label: '🔍 데이터 검수' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${
                activeTab === tab.id 
                  ? 'bg-surface-3 text-white shadow-inner' 
                  : 'text-text-dim hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab Content ── */}
        <div className="min-h-[60vh]">
          <AnimatePresence mode="wait">
            
            {/* Dashboard Tab */}
            {activeTab === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {!isConnected && (
                  <div className="bg-red/10 border border-red/20 px-4 py-3 rounded-xl text-red text-sm font-bold animate-in fade-in zoom-in-95">
                    ⚠ Firebase 연결이 끊겼습니다. 오프라인 모드로 작동 중입니다.
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {roomStatusList.map((room) => (
                    <div 
                      key={room.key}
                      className={`group bg-surface rounded-2xl border transition-all duration-300 ${
                        room.isManualActive 
                          ? 'border-purple/30 shadow-[0_0_30px_rgba(176,132,247,0.1)]' 
                          : 'border-white/[0.05] hover:border-white/10'
                      }`}
                    >
                      <div className="p-4 border-b border-white/[0.05] flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ background: room.color }} />
                          <h3 className="font-bold text-sm">{room.label}</h3>
                        </div>
                        {room.isManualActive && (
                          <span className="text-[10px] font-black bg-purple/10 text-purple px-2 py-0.5 rounded-full uppercase tracking-widest">Manual</span>
                        )}
                        <span className="text-[10px] font-bold text-text-dim bg-surface-2 px-2 py-0.5 rounded-full uppercase">{room.floor}</span>
                      </div>
                      <div className="p-5 space-y-4">
                        <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black tracking-widest uppercase ${
                          room.active ? (room.isManualActive ? 'bg-purple/10 text-purple' : 'bg-accent/10 text-accent') : 'bg-green/10 text-green'
                        }`}>
                          <div className={`w-1.5 h-1.5 rounded-full bg-current ${room.active ? 'animate-pulse' : ''}`} />
                          {room.active ? 'In Use' : 'Available'}
                        </div>
                        <div className="min-h-[3rem]">
                          {room.active ? (
                            <div className="space-y-1">
                              <h4 className="text-xl font-bold leading-tight line-clamp-2">{room.active.name}</h4>
                              <p className="text-xs font-bold text-text-dim tabular-nums">⏱ {room.active.start} ~ {room.active.end}</p>
                            </div>
                          ) : (
                            <p className="text-lg font-medium text-text-dim">현재 운영 중인 프로그램이 없습니다.</p>
                          )}
                        </div>
                        <div className="pt-4 border-t border-white/[0.05] flex flex-col gap-2">
                          {room.nextProg ? (
                            <p className="text-[10px] text-text-dim font-bold">
                              NEXT: <span className="text-yellow">{room.nextProg.name}</span> ({room.nextProg.start}~{room.nextProg.end})
                            </p>
                          ) : (
                            <p className="text-[10px] text-text-dim font-bold uppercase tracking-widest opacity-40">No Upcoming Today</p>
                          )}
                          <div className="flex gap-2 pt-1">
                            {room.isManualActive ? (
                              <button 
                                onClick={() => clearManual(room.key)}
                                className="flex-1 bg-surface-2 hover:bg-red/10 hover:text-red p-2 rounded-xl text-[10px] font-black transition-all"
                              >
                                ✕ 수동 해제
                              </button>
                            ) : (
                              <button 
                                onClick={() => { setActiveTab('manual'); setTimeout(() => document.getElementById(`mn-name-${room.key}`)?.focus(), 150); }}
                                className="flex-1 bg-surface-2 hover:bg-accent/10 hover:text-accent p-2 rounded-xl text-[10px] font-black transition-all"
                              >
                                ✏ 수동 설정
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Manual Control Tab */}
            {activeTab === 'manual' && (
              <motion.div
                key="manual"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-surface/50 p-6 rounded-3xl border border-white/5">
                  <p className="text-sm font-medium text-text-dim">
                    실시간 현황판에 특정 프로그램을 즉시 노출하고 싶을 때 사용합니다.<br/>
                    설정 즉시 모든 연결된 화면에 반영되며, 수동 해제 전까지는 자동 시간표보다 우선 상위 노출됩니다.
                  </p>
                  <button 
                    onClick={clearAllManual}
                    className="bg-red/10 text-red hover:bg-red/20 border border-red/20 px-6 py-2.5 rounded-xl text-sm font-black transition-all"
                  >
                    🗑 모든 수동 제어 전체 해제
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {ROOMS.map((room) => {
                    const isManual = !!manualOv[room.key]?.active;
                    return (
                      <div key={room.key} className={`bg-surface p-6 rounded-3xl border ${isManual ? 'border-purple/30' : 'border-white/5'} space-y-6`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-2.5 h-2.5 rounded-full shadow-lg" style={{ background: room.color, boxShadow: `0 0 15px ${room.color}44` }} />
                            <h3 className="text-xl font-bold">{room.label}</h3>
                          </div>
                          {isManual && (
                            <span className="text-[10px] font-black bg-purple/10 text-purple px-3 py-1 rounded-full uppercase tracking-widest border border-purple/20">Active Manual Control</span>
                          )}
                        </div>
                        
                        {isManual && (
                          <div className="bg-purple/5 border border-purple/10 rounded-2xl p-4 animate-in zoom-in-95">
                            <p className="text-xs font-bold text-purple uppercase tracking-widest mb-2 opacity-60">현재 수동 운영 중</p>
                            <h4 className="text-lg font-bold">{manualOv[room.key].name}</h4>
                            <p className="text-xs font-medium text-text-dim">{manualOv[room.key].start} ~ {manualOv[room.key].end}</p>
                          </div>
                        )}

                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">프로그램명</label>
                            <input 
                              id={`mn-name-${room.key}`}
                              type="text" 
                              placeholder="예: 노래교실, 긴급 행사..."
                              value={manualInputs[room.key].name}
                              onChange={(e) => handleManualInput(room.key, 'name', e.target.value)}
                              className="w-full bg-surface-2 border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">시작 시간</label>
                              <input 
                                type="time" 
                                value={manualInputs[room.key].start}
                                onChange={(e) => handleManualInput(room.key, 'start', e.target.value)}
                                className="w-full bg-surface-2 border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-black text-text-dim uppercase tracking-widest ml-1">종료 시간</label>
                              <input 
                                type="time" 
                                value={manualInputs[room.key].end}
                                onChange={(e) => handleManualInput(room.key, 'end', e.target.value)}
                                className="w-full bg-surface-2 border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => applyManual(room.key)}
                              className="flex-[2] bg-accent hover:bg-accent/90 text-white p-3.5 rounded-xl font-black text-sm transition-all active:scale-95 shadow-lg shadow-accent/20"
                            >
                              설정 적용
                            </button>
                            <button 
                              onClick={() => clearManual(room.key)}
                              disabled={!isManual}
                              className={`flex-1 p-3.5 rounded-xl font-black text-sm transition-all ${
                                isManual ? 'bg-surface-2 text-white hover:bg-red/10 hover:text-red active:scale-95' : 'bg-white/5 text-white/20'
                              }`}
                            >
                              해제
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}

            {/* Upload Tab */}
            {activeTab === 'upload' && (
              <motion.div
                key="upload"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-3xl mx-auto space-y-6"
              >
                <div className="bg-surface p-10 rounded-[2.5rem] border border-white/5 shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-1 h-full bg-accent" />
                  <div className="space-y-8">
                    <div className="space-y-2">
                        <h3 className="text-3xl font-black text-white">시간표 클라우드 동기화</h3>
                        <p className="text-text-dim text-sm font-medium">관리용 주간 시간표 엑셀 파일을 업로드하여 모든 현황판을 즉시 업데이트합니다.</p>
                    </div>
                    
                    <div className="bg-surface-2/50 border-2 border-dashed border-white/10 rounded-3xl p-10 flex flex-col items-center gap-6 group hover:border-accent/40 transition-all">
                        <div className="p-5 bg-accent/10 text-accent rounded-full group-hover:scale-110 transition-transform">
                            <Upload size={40} />
                        </div>
                        <input 
                            type="file" 
                            ref={fileInputRef}
                            accept=".xlsx, .xls"
                            className="text-sm font-medium text-text-dim file:mr-6 file:py-3 file:px-6 file:rounded-xl file:border-0 file:bg-surface-3 file:text-white file:font-bold hover:file:bg-accent transition-all cursor-pointer"
                        />
                        <div className="text-center space-y-1">
                            <p className="text-xs font-bold text-text-dim">파일 지원: Microsoft Excel (.xlsx, .xls)</p>
                            <p className="text-xs font-bold text-accent/50">첫 번째 시트의 내용을 자동으로 분석합니다.</p>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        <button 
                            onClick={handleUpload}
                            disabled={isUploading}
                            className="w-full bg-accent hover:bg-accent/90 disabled:bg-surface-3 disabled:text-text-dim p-4.5 rounded-2xl font-black text-lg shadow-xl shadow-accent/20 transition-all active:scale-95"
                        >
                            {isUploading ? '분석 중...' : '클라우드로 데이터 전송'}
                        </button>
                        <button 
                            onClick={clearAllSchedule}
                            className="w-full bg-white/5 hover:bg-red/10 hover:text-red p-3 rounded-xl text-xs font-bold text-text-dim transition-all"
                        >
                            저장된 통합 시간표 전체 초기화
                        </button>
                    </div>

                    {uploadStatus.message && (
                    <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className={`p-4 rounded-xl text-sm font-bold flex items-center gap-3 ${
                            uploadStatus.type === 'loading' ? 'bg-accent/10 text-accent border border-accent/20' :
                            uploadStatus.type === 'success' ? 'bg-green/10 text-green border border-green/20' :
                            'bg-red/10 text-red border border-red/20'
                        }`}
                    >
                        {uploadStatus.type === 'loading' && <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />}
                        {uploadStatus.message}
                    </motion.div>
                    )}
                  </div>
                </div>

                <div className="bg-surface/30 p-8 rounded-3xl border border-white/5 space-y-4">
                    <h4 className="text-xs font-black text-text-dim uppercase tracking-[0.2em] flex items-center gap-2">
                        <Database size={14} />
                        Guidelines for Excel Format
                    </h4>
                    <ul className="text-xs text-text-dim font-medium space-y-2 list-disc ml-5 leading-loose">
                        <li>복지관 전체 시간표 서식에서 <strong>'요일'</strong> 행과 <strong>'구분'</strong> 행을 반드시 포함해야 합니다.</li>
                        <li>방 이름 키워드(어울림실, 청춘나래 등)가 포함된 열을 자동으로 인식합니다.</li>
                        <li>엑셀의 <strong>병합된 셀</strong>도 스마트하게 인식하여 모든 시간대에 프로그램이 매핑됩니다.</li>
                        <li>업로드가 완료되면 실시간 대시보드 및 검수 탭에서 확인 가능합니다.</li>
                    </ul>
                </div>
              </motion.div>
            )}

            {/* Check Tab */}
            {activeTab === 'check' && (
              <motion.div
                key="check"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black text-white flex items-center gap-3">
                        <Database className="text-accent" />
                        클라우드 통합 데이터 검수
                    </h3>
                    <div className="px-5 py-2.5 bg-accent/10 border border-accent/20 rounded-full text-accent text-sm font-black tabular-nums">
                        총 {Object.values(scheduleData).flat().length}개 프로그램 동기화 중
                    </div>
                </div>

                <div className="bg-surface rounded-3xl border border-white/5 overflow-hidden shadow-2xl">
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="bg-surface-2 text-text-dim text-[11px] font-black uppercase tracking-wider">
                                    <th className="py-5 px-6 text-left">Room</th>
                                    <th className="py-5 px-6 text-center">Day</th>
                                    <th className="py-5 px-6 text-center">Schedule</th>
                                    <th className="py-5 px-6 text-left">Program Name</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {(Object.entries(scheduleData) as [string, ScheduleItem[]][]).flatMap(([roomName, progs]) => 
                                    progs.sort((a,b) => (DAY_LIST.indexOf(a.day) - DAY_LIST.indexOf(b.day)) || (toMin(a.start) - toMin(b.start))).map((p, i) => (
                                        <tr key={`${roomName}-${i}`} className="hover:bg-white/[0.02] transition-colors">
                                            <td className="py-4 px-6">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-2 h-2 rounded-full" style={{ background: ROOMS.find(r => r.key === roomName)?.color }} />
                                                    <span className="font-black text-sm">{roomName}</span>
                                                </div>
                                            </td>
                                            <td className="py-4 px-6 text-center">
                                                <span className="inline-block px-3 py-1 rounded-lg text-[10px] font-black uppercase" style={{ background: (DAY_CLR[p.day] || '#888') + '22', color: DAY_CLR[p.day] }}>
                                                    {p.day}
                                                </span>
                                            </td>
                                            <td className="py-4 px-6 text-center text-xs font-mono text-text-dim tracking-tight tabular-nums">
                                                {p.start} ~ {p.end}
                                            </td>
                                            <td className="py-4 px-6">
                                                <div className="text-sm font-bold text-white/80">{p.name}</div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                                {Object.values(scheduleData).flat().length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="py-24 text-center">
                                            <div className="flex flex-col items-center gap-4 opacity-20">
                                                <Database size={60} strokeWidth={1} />
                                                <p className="text-lg font-medium italic">클라우드에 저장된 데이터가 없습니다.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* ── Footer ── */}
        <footer className="pt-20 pb-10 flex flex-col items-center gap-4 border-t border-white/5 opacity-40">
            <p className="text-[10px] font-black tracking-[0.3em] uppercase">Built for Yeonhee Senior Welfare Center</p>
            <div className="flex gap-6 text-[10px] font-bold">
                <span className="hover:text-accent cursor-default transition-colors">REALTIME ENGINE LIVE</span>
                <span className="hover:text-accent cursor-default transition-colors">v2.0 CLOUD SYNCED</span>
            </div>
        </footer>

      </div>
    </div>
  );
}
