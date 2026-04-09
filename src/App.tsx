/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, CheckCircle2, PlayCircle, Calendar, MapPin, ChevronDown, ChevronUp, Settings, Upload, X, AlertCircle } from 'lucide-react';
import Papa from 'papaparse';
import { db } from './firebase';
import { ref, onValue, set } from 'firebase/database';

// 기본 시간표 데이터 (클라우드에 데이터가 없을 때만 사용됩니다)
const defaultScheduleData: Record<string, Array<{ day: string; start: string; end: string; name: string }>> = {
  "어울림실(B1)": [
    { day: "월", start: "09:00", end: "10:00", name: "디지털 서포터즈" },
    { day: "화", start: "09:00", end: "10:00", name: "디지털 서포터즈" },
    { day: "수", start: "09:00", end: "10:00", name: "디지털 서포터즈" },
    { day: "목", start: "09:00", end: "10:00", name: "디지털 서포터즈" },
    { day: "금", start: "09:00", end: "10:00", name: "디지털 서포터즈" }
  ],
  "청춘나래(F3/왼)": [
    { day: "월", start: "10:00", end: "11:00", name: "칼림바" },
    { day: "월", start: "15:00", end: "16:00", name: "오카리나 초급" },
    { day: "화", start: "10:00", end: "11:00", name: "생활영어회화" },
    { day: "목", start: "13:00", end: "14:00", name: "영어문법" },
    { day: "금", start: "11:00", end: "12:00", name: "스마트폰 중급" },
    { day: "금", start: "16:00", end: "17:00", name: "오카리나 중급" }
  ],
  "청춘누리(F3/오)": [
    { day: "월", start: "10:00", end: "11:00", name: "칼림바" },
    { day: "월", start: "13:00", end: "14:00", name: "미술동아리" },
    { day: "월", start: "15:00", end: "16:00", name: "오카리나 초급" },
    { day: "화", start: "14:00", end: "16:00", name: "수채화" },
    { day: "수", start: "10:00", end: "11:00", name: "캘리그래피" },
    { day: "금", start: "09:30", end: "10:30", name: "스마트폰 초급" },
    { day: "금", start: "13:30", end: "14:30", name: "색연필드로잉" },
    { day: "금", start: "16:00", end: "17:00", name: "오카리나 중급" }
  ],
  "청춘마루(F4)": [
    { day: "월", start: "10:00", end: "11:00", name: "라인댄스" },
    { day: "월", start: "14:00", end: "15:00", name: "스포츠댄스" },
    { day: "화", start: "10:00", end: "11:00", name: "의자요가" },
    { day: "수", start: "09:15", end: "10:15", name: "맷돌체조" },
    { day: "수", start: "10:40", end: "11:40", name: "단학기공" },
    { day: "수", start: "16:00", end: "16:50", name: "체력측정 체조수업" },
    { day: "목", start: "10:00", end: "11:30", name: "노래교실" },
    { day: "목", start: "14:00", end: "15:00", name: "소도구 필라테스" },
    { day: "금", start: "10:00", end: "11:00", name: "웃음레크레이션" }
  ]
};

function timeToMinutes(timeStr: string) {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + (minutes || 0);
}

export default function App() {
  const [now, setNow] = useState(new Date());
  const [showTimetable, setShowTimetable] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [scheduleData, setScheduleData] = useState<Record<string, Array<{ day: string; start: string; end: string; name: string }>>>(defaultScheduleData);
  const [overrides, setOverrides] = useState<Record<string, { status: 'auto' | 'available' | 'in-use'; name?: string; time?: string }>>({});
  
  // 수동 제어 필드 상태
  const [manualRoom, setManualRoom] = useState("어울림실(B1)");
  const [manualStatus, setManualStatus] = useState<'auto' | 'available' | 'in-use'>("auto");
  const [manualName, setManualName] = useState("");
  const [manualTime, setManualTime] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. 클라우드 데이터 실시간 수신 (시간표 & 수동설정)
  useEffect(() => {
    const scheduleRef = ref(db, 'welfareSchedule');
    const overridesRef = ref(db, 'manualOverrides');

    const unsubSchedule = onValue(scheduleRef, (snapshot) => {
      const data = snapshot.val();
      if (data) setScheduleData(data);
    });

    const unsubOverrides = onValue(overridesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) setOverrides(data);
    });

    return () => {
      unsubSchedule();
      unsubOverrides();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const currentDay = days[now.getDay()];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const roomStatus = useMemo(() => {
    const rooms = ["어울림실(B1)", "청춘나래(F3/왼)", "청춘누리(F3/오)", "청춘마루(F4)"];
    
    return rooms.map(roomName => {
      const manual = overrides[roomName];
      let isRunning = false;
      let programName = "비어 있음";
      let displayTime = "";
      let source: 'auto' | 'manual' = 'auto';

      if (manual && manual.status !== 'auto') {
        source = 'manual';
        if (manual.status === 'in-use') {
          isRunning = true;
          programName = manual.name || "프로그램 정보 없음";
          displayTime = manual.time || "";
        } else {
          isRunning = false;
        }
      } else {
        const programs = scheduleData[roomName] || [];
        const activeProgram = programs.find(prog => {
          if (prog.day !== currentDay) return false;
          const startMin = timeToMinutes(prog.start);
          const endMin = timeToMinutes(prog.end);
          return currentMinutes >= startMin && currentMinutes <= endMin;
        });

        if (activeProgram) {
          isRunning = true;
          programName = activeProgram.name;
          displayTime = `${activeProgram.start} ~ ${activeProgram.end}`;
        }
      }

      return {
        roomName,
        isRunning,
        programName,
        displayTime,
        source
      };
    });
  }, [currentDay, currentMinutes, scheduleData, overrides]);

  // 2. 엑셀 분석 및 업로드 (스마트 스캐너 로직)
  const handleCSVUpload = () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      alert("파일을 먼저 선택해주세요!");
      return;
    }

    Papa.parse(file, {
      complete: (results) => {
        const newData: Record<string, Array<{ day: string; start: string; end: string; name: string }>> = {};
        let currentRoom: string | null = null;
        let dayIndices: Record<string, number> = {};
        const roomMap: Record<string, string> = {
          "어울림실": "어울림실(B1)", 
          "청춘나래": "청춘나래(F3/왼)", 
          "청춘누리": "청춘누리(F3/오)", 
          "청춘마루": "청춘마루(F4)"
        };

        (results.data as string[][]).forEach(row => {
          const first = String(row[0] || "").trim();
          if (first.includes("시간표")) {
            for (let key in roomMap) { if (first.includes(key)) currentRoom = roomMap[key]; }
            if (currentRoom && !newData[currentRoom]) newData[currentRoom] = [];
            return;
          }
          if (currentRoom && row.includes("월") && row.includes("화")) {
            dayIndices = {};
            row.forEach((cell, i) => { if (["월","화","수","목","금"].includes(String(cell).trim())) dayIndices[String(cell).trim()] = i; });
            return;
          }
          const timeMatch = first.match(/(\d{2}:\d{2})-(\d{2}:\d{2})/);
          if (currentRoom && Object.keys(dayIndices).length > 0 && timeMatch) {
            for (let day in dayIndices) {
              const val = String(row[dayIndices[day]] || "").trim();
              if (val) {
                let s = timeMatch[1], e = timeMatch[2];
                const cellTime = val.match(/(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})/);
                if (cellTime) { s = cellTime[1].padStart(5,'0'); e = cellTime[2].padStart(5,'0'); }
                newData[currentRoom].push({ 
                  day, 
                  start: s, 
                  end: e, 
                  name: val.replace(/\d{1,2}:\d{2}.*/g, '').replace(/\n/g, ' ').trim() 
                });
              }
            }
          }
        });

        if (Object.keys(newData).length === 0) {
          alert("시간표 데이터를 찾지 못했습니다. 복지관 서식이 맞는지 확인해주세요.");
          return;
        }

        // 클라우드 동기화
        set(ref(db, 'welfareSchedule'), newData)
          .then(() => {
            alert("전체 화면이 실시간으로 동기화되었습니다! 🚀");
            setShowAdminPanel(false);
          })
          .catch((error) => {
            console.error("Firebase update failed", error);
            alert("동기화 중 오류가 발생했습니다.");
          });
      }
    });
  };

  const handleManualOverride = () => {
    if (manualStatus === 'in-use' && (!manualName || !manualTime)) {
      alert("수동으로 운영 중일 때는 프로그램명과 시간을 모두 입력해주세요!");
      return;
    }

    const data = {
      status: manualStatus,
      name: manualStatus === 'in-use' ? manualName : null,
      time: manualStatus === 'in-use' ? manualTime : null
    };

    set(ref(db, `manualOverrides/${manualRoom}`), data)
      .then(() => {
        alert(`[${manualRoom}] 수동 설정이 적용되었습니다!`);
        setManualName("");
        setManualTime("");
      })
      .catch(() => alert("설정 적용 중 오류가 발생했습니다."));
  };

  const resetToDefault = () => {
    if (confirm("기본 시간표로 초기화하시겠습니까?")) {
      // 시간표 초기화
      set(ref(db, 'welfareSchedule'), defaultScheduleData);
      // 수동 설정 초기화
      set(ref(db, 'manualOverrides'), {});
      alert("기본 데이터로 초기화 및 동기화되었습니다.");
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans selection:bg-blue-100">
      {/* Admin Toggle Button */}
      <button 
        onClick={() => setShowAdminPanel(!showAdminPanel)}
        className="fixed top-6 right-6 z-50 bg-white/80 backdrop-blur-md border border-slate-200 p-3 rounded-full shadow-lg hover:bg-white transition-all text-slate-600 hover:text-red-600 group"
        title="관리자 설정"
      >
        <Settings size={20} className="group-hover:rotate-90 transition-transform duration-500" />
      </button>

      {/* Admin Panel Modal */}
      <AnimatePresence>
        {showAdminPanel && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAdminPanel(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200"
            >
              <div className="bg-amber-50 border-b border-amber-100 p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xl font-bold text-amber-900 flex items-center gap-2">
                    <Settings className="text-amber-600" size={24} />
                    관리자 설정
                  </h3>
                  <button onClick={() => setShowAdminPanel(false)} className="text-amber-900/50 hover:text-amber-900 transition-colors">
                    <X size={24} />
                  </button>
                </div>
                <p className="text-amber-800/70 text-sm leading-relaxed">
                  복지관 원본 엑셀 시간표를 <strong>"CSV UTF-8 (쉼표로 분리)"</strong> 형식으로 저장 후 올려주세요.
                </p>
                <p className="text-red-600 text-xs mt-2 font-bold">
                  (클라우드 동기화 버튼을 누르면 모든 화면이 실시간으로 업데이트됩니다!)
                </p>
              </div>

              <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto">
                {/* Section 1: CSV Upload */}
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2">
                    <span className="w-6 h-6 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center text-xs">1</span>
                    전체 시간표 자동화 (엑셀 업로드)
                  </h4>
                  <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center space-y-4">
                    <div className="bg-white w-10 h-10 rounded-full shadow-sm flex items-center justify-center mx-auto text-slate-400">
                      <Upload size={20} />
                    </div>
                    <div>
                      <input 
                        type="file" 
                        ref={fileInputRef}
                        accept=".csv" 
                        className="hidden" 
                        id="csv-upload"
                      />
                      <label 
                        htmlFor="csv-upload"
                        className="inline-flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors shadow-sm text-sm"
                      >
                        원본 CSV 파일 선택
                      </label>
                    </div>
                    <button 
                      onClick={handleCSVUpload}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl font-bold shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                    >
                      <Upload size={18} />
                      클라우드 동기화
                    </button>
                  </div>
                </div>

                {/* Section 2: Manual Override */}
                <div className="space-y-4">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2">
                    <span className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs">2</span>
                    개별 프로그램실 수동 제어
                  </h4>
                  <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 ml-1">프로그램실 선택</label>
                        <select 
                          value={manualRoom}
                          onChange={(e) => setManualRoom(e.target.value)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        >
                          <option value="어울림실(B1)">어울림실(B1)</option>
                          <option value="청춘나래(F3/왼)">청춘나래(F3/왼)</option>
                          <option value="청춘누리(F3/오)">청춘누리(F3/오)</option>
                          <option value="청춘마루(F4)">청춘마루(F4)</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 ml-1">상태 설정</label>
                        <select 
                          value={manualStatus}
                          onChange={(e) => setManualStatus(e.target.value as any)}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        >
                          <option value="auto">자동 (시간표 기준)</option>
                          <option value="available">강제 비움 (사용 가능)</option>
                          <option value="in-use">수동 입력 (운영 중)</option>
                        </select>
                      </div>
                    </div>

                    {manualStatus === 'in-use' && (
                      <motion.div 
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-3"
                      >
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-500 ml-1">프로그램명</label>
                          <input 
                            type="text"
                            value={manualName}
                            onChange={(e) => setManualName(e.target.value)}
                            placeholder="예: 임시 회의"
                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-slate-500 ml-1">시간 정보</label>
                          <input 
                            type="text"
                            value={manualTime}
                            onChange={(e) => setManualTime(e.target.value)}
                            placeholder="예: 14:00 - 15:00"
                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                        </div>
                      </motion.div>
                    )}

                    <button 
                      onClick={handleManualOverride}
                      className="w-full bg-slate-800 hover:bg-slate-900 text-white py-3 rounded-xl font-bold transition-all shadow-md"
                    >
                      수동 상태 적용하기
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100">
                  <button 
                    onClick={resetToDefault}
                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 py-3 rounded-xl font-semibold transition-colors text-sm"
                  >
                    모든 데이터 초기화
                  </button>
                </div>

                <div className="flex items-start gap-3 bg-blue-50 p-4 rounded-xl text-blue-800 text-xs leading-relaxed">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <p>업로드된 데이터는 Firebase 클라우드에 저장되어, 모든 사용자의 화면에 실시간으로 반영됩니다.</p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Header Section */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
              <span className="bg-blue-600 text-white p-1.5 rounded-lg">
                <MapPin size={24} />
              </span>
              연희노인복지관 프로그램실 현황
            </h1>
            <p className="text-slate-500 mt-1 text-sm font-medium">실시간 운영 상태 및 주간 시간표</p>
          </div>
          <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-full border border-slate-200">
            <Clock className="text-blue-600 animate-pulse" size={18} />
            <span className="text-sm font-semibold tabular-nums">
              {now.getFullYear()}년 {now.getMonth() + 1}월 {now.getDate()}일 ({currentDay}) {now.getHours().toString().padStart(2, '0')}:{now.getMinutes().toString().padStart(2, '0')}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-12">
        {/* Real-time Dashboard */}
        <section>
          <div className="flex items-center gap-2 mb-6">
            <div className="w-2 h-8 bg-blue-600 rounded-full"></div>
            <h2 className="text-xl font-bold text-slate-800">실시간 현황</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <AnimatePresence mode="popLayout">
              {roomStatus.map((status) => (
                <motion.div
                  key={status.roomName}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  whileHover={{ y: -4 }}
                  className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-all duration-200"
                >
                  <div className="flex flex-col h-full justify-between gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-slate-700">{status.roomName}</h3>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                          status.source === 'manual' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {status.source === 'manual' ? '수동 제어' : '자동 시간표'}
                        </span>
                      </div>
                      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold ${
                        status.isRunning 
                          ? 'bg-blue-50 text-blue-700 border border-blue-100' 
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                      }`}>
                        {status.isRunning ? <PlayCircle size={16} /> : <CheckCircle2 size={16} />}
                        {status.isRunning ? '운영 중' : '사용 가능'}
                      </div>
                    </div>
                    <div className={`mt-4 p-4 rounded-xl ${status.isRunning ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-400'}`}>
                      <p className="text-xs font-bold uppercase tracking-wider opacity-80 mb-1">현재 프로그램</p>
                      <p className="font-bold truncate">{status.programName}</p>
                      {status.isRunning && status.displayTime && (
                        <p className="text-[10px] mt-1 opacity-80 tabular-nums">{status.displayTime}</p>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>

        {/* Timetable Section */}
        <section>
          <button 
            onClick={() => setShowTimetable(!showTimetable)}
            className="w-full md:w-auto flex items-center justify-center gap-3 bg-slate-100 hover:bg-slate-200 text-slate-800 px-6 py-3 rounded-xl font-bold transition-all border border-slate-200 mb-6 group"
          >
            <Calendar size={20} className="text-slate-500 group-hover:text-slate-800" />
            📅 주간 프로그램 시간표 {showTimetable ? '접기' : '펼치기'}
            {showTimetable ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
          </button>

          <AnimatePresence>
            {showTimetable && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-6 py-4 text-sm font-bold text-slate-600">프로그램실</th>
                          <th className="px-6 py-4 text-sm font-bold text-slate-600">요일</th>
                          <th className="px-6 py-4 text-sm font-bold text-slate-600">시간</th>
                          <th className="px-6 py-4 text-sm font-bold text-slate-600">프로그램명</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(Object.entries(scheduleData) as [string, typeof defaultScheduleData[string]][]).flatMap(([roomName, programs]) => 
                          programs.map((prog, idx) => (
                            <tr key={`${roomName}-${idx}`} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-6 py-4 text-sm font-bold text-slate-900">{roomName}</td>
                              <td className="px-6 py-4 text-sm">
                                <span className={`px-2 py-1 rounded-md font-bold ${
                                  prog.day === currentDay ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {prog.day}요일
                                </span>
                              </td>
                              <td className="px-6 py-4 text-sm text-slate-600 font-medium tabular-nums">
                                {prog.start} - {prog.end}
                              </td>
                              <td className="px-6 py-4 text-sm font-semibold text-slate-800">{prog.name}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      <footer className="max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8 text-center text-slate-400 text-sm">
        <p>© {new Date().getFullYear()} 연희노인복지관. All rights reserved.</p>
      </footer>
    </div>
  );
}
