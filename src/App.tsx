import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Clock, CheckCircle2, PlayCircle, Calendar, Settings, Upload, MapPin, ChevronDown, ChevronUp, Database } from 'lucide-react';
import * as XLSX from 'xlsx';
import { db } from './firebase';
import { ref, onValue, set } from 'firebase/database';
import { motion, AnimatePresence } from 'motion/react';

// 정제된 방 이름 목록 (하이픈 사용)
const ROOMS = ["어울림실(B1)", "청춘나래(F3-왼)", "청춘누리(F3-오)", "청춘마루(F4)"];

interface ScheduleItem {
  day: string;
  start: string;
  end: string;
  name: string;
}

interface ManualOverride {
  status: 'auto' | 'available' | 'in-use';
  name?: string;
  time?: string;
}

export default function App() {
  const [scheduleData, setScheduleData] = useState<Record<string, ScheduleItem[]>>({});
  const [overrides, setOverrides] = useState<Record<string, ManualOverride>>({});
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showTimetable, setShowTimetable] = useState(false);
  
  // 업로드 상태 관리
  const [uploadStatus, setUploadStatus] = useState<{ message: string; type: 'success' | 'error' | 'loading' | '' }>({ message: '', type: '' });
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 수동 제어 폼 상태
  const [manualRoom, setManualRoom] = useState(ROOMS[0]);
  const [manualStatusType, setManualStatusType] = useState<'auto' | 'available' | 'in-use'>('auto');
  const [manualName, setManualName] = useState('');
  const [manualTime, setManualTime] = useState('');

  // 1. 실시간 클라우드 데이터 구독
  useEffect(() => {
    const scheduleRef = ref(db, 'welfareSchedule');
    const overridesRef = ref(db, 'manualOverrides');

    const unsubSchedule = onValue(scheduleRef, (snapshot) => {
      setScheduleData(snapshot.val() || {});
    });

    const unsubOverrides = onValue(overridesRef, (snapshot) => {
      setOverrides(snapshot.val() || {});
    });

    const timer = setInterval(() => setCurrentTime(new Date()), 1000);

    return () => {
      unsubSchedule();
      unsubOverrides();
      clearInterval(timer);
    };
  }, []);

  // 2. 현재 시간 및 요일 정보
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const currentDay = days[currentTime.getDay()];
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  // 3. 실시간 현황 계산 (메모이제이션)
  const roomStatus = useMemo(() => {
    return ROOMS.map(roomName => {
      const manual = overrides[roomName];
      let isActive = false;
      let progName = "";
      let progTime = "";
      let source = "자동 시간표";

      // 수동 제어 우선 순위
      if (manual && manual.status !== 'auto') {
        if (manual.status === 'in-use') {
          isActive = true;
          progName = manual.name || "프로그램 정보 없음";
          progTime = manual.time || "";
          source = "수동 제어";
        } else if (manual.status === 'available') {
          isActive = false;
        }
      } else {
        // 자동 시간표 확인
        const programs = scheduleData[roomName] || [];
        const currentProg = programs.find(p => 
          p.day === currentDay && 
          currentMinutes >= toMin(p.start) && 
          currentMinutes <= toMin(p.end)
        );

        if (currentProg) {
          isActive = true;
          progName = currentProg.name;
          progTime = `${currentProg.start} ~ ${currentProg.end}`;
        }
      }

      return { roomName, isActive, progName, progTime, source };
    });
  }, [currentDay, currentMinutes, scheduleData, overrides]);

  // 4. 엑셀 업로드 핸들러
  const handleFileUpload = () => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      alert("⚠️ 원본 엑셀 파일을 먼저 선택해주세요!");
      return;
    }

    setIsUploading(true);
    setUploadStatus({ message: "⏳ 엑셀 파일을 정밀 분석 중입니다...", type: "loading" });

    const reader = new FileReader();
    reader.onload = (e) => {
      setTimeout(() => { // UI 업데이트를 위한 여유 지연
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

          const parsedData = parseWelfareExcel(jsonData);
          
          setUploadStatus({ message: "🚀 클라우드에 전송하고 있습니다...", type: "loading" });

          set(ref(db, 'welfareSchedule'), parsedData)
            .then(() => {
              setUploadStatus({ message: "✅ 동기화 성공! 모든 화면이 업데이트되었습니다.", type: "success" });
              setIsUploading(false);
              alert("엑셀 시간표가 성공적으로 동기화되었습니다!\n화면 아래의 [데이터 검수하기] 버튼을 눌러보세요.");
              setTimeout(() => setUploadStatus({ message: "", type: "" }), 5000);
            })
            .catch((err) => {
              setUploadStatus({ message: "❌ 전송 실패: " + err.message, type: "error" });
              setIsUploading(false);
            });
        } catch (error: any) {
          setUploadStatus({ message: "❌ 오류 발생: " + error.message, type: "error" });
          setIsUploading(false);
        }
      }, 200);
    };
    reader.readAsArrayBuffer(file);
  };

  const parseWelfareExcel = (data: any[][]) => {
    const result: Record<string, ScheduleItem[]> = {};
    ROOMS.forEach(r => result[r] = []);

    let dayRow = -1;
    let roomRow = -1;
    
    // 헤더 위치 스캔
    for(let i = 0; i < Math.min(15, data.length); i++) {
        if(data[i] && String(data[i][0] || "").includes("요일")) dayRow = i;
        if(data[i] && String(data[i][0] || "").includes("구분")) roomRow = i;
    }

    if(dayRow === -1) throw new Error("엑셀에서 '요일' 행을 찾을 수 없습니다. 지원 서식을 확인해주세요.");

    // 요일 매핑
    let dayMap: Record<number, string> = {};
    let currentDayLabel = "";
    data[dayRow].forEach((cell, idx) => {
      let val = String(cell || "").trim();
      if(["월","화","수","목","금"].includes(val)) currentDayLabel = val;
      if(currentDayLabel) dayMap[idx] = currentDayLabel;
    });

    // 데이터 추출
    for(let r = roomRow + 1; r < data.length; r++) {
      let timeHeader = String(data[r][0] || "").trim();
      let timeMatch = timeHeader.match(/(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})/);
      if(!timeMatch) continue;

      let rowStart = timeMatch[1].padStart(5, '0');
      let rowEnd = timeMatch[2].padStart(5, '0');

      for(let c = 1; c < data[r].length; c++) {
        let progName = String(data[r][c] || "").trim();
        if(!progName || !dayMap[c]) continue;

        // 방 이름 식별 (빗금/하이픈 유연하게 처리)
        let rawRoomHeader = String(data[roomRow][c] || "").replace(/\//g, '-').trim();
        let matchedRoom = ROOMS.find(rn => {
          const baseName = rn.split('(')[0];
          return rawRoomHeader.includes(baseName);
        });

        if(matchedRoom) {
          let finalStart = rowStart;
          let finalEnd = rowEnd;
          
          // 셀 내부 특수 시간 스캔
          const innerTime = progName.match(/(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})/);
          if(innerTime) {
            finalStart = innerTime[1].padStart(5, '0');
            finalEnd = innerTime[2].padStart(5, '0');
          }

          let cleanName = progName
            .replace(/(\d{1,2}:\d{2})\s*[~-]\s*(\d{1,2}:\d{2})/g, '')
            .replace(/\n/g, ' ')
            .trim();

          result[matchedRoom].push({
            day: dayMap[c],
            start: finalStart,
            end: finalEnd,
            name: cleanName
          });
        }
      }
    }
    return result;
  };

  // 5. 수동 제어 적용
  const handleManualSet = () => {
    if (manualStatusType === 'in-use' && (!manualName || !manualTime)) {
      alert("수동 운영 중일 때는 프로그램명과 시간을 모두 입력해주세요!");
      return;
    }

    set(ref(db, `manualOverrides/${manualRoom}`), {
      status: manualStatusType,
      name: manualStatusType === 'in-use' ? manualName : null,
      time: manualStatusType === 'in-use' ? manualTime : null
    }).then(() => {
      alert(`[${manualRoom}] 설정이 적용되었습니다.`);
      if (manualStatusType === 'in-use') {
        setManualName('');
        setManualTime('');
      }
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
              <span className="p-2 bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-200">
                <Clock size={28} />
              </span>
              연희노인복지관 실시간 현황
            </h1>
            <p className="text-slate-500 font-medium flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              클라우드 실시간 동기화 중
            </p>
          </div>
          
          <div className="flex items-center gap-4 bg-white px-6 py-4 rounded-2xl shadow-sm border border-slate-100">
            <div className="text-right">
              <div className="text-sm font-bold text-slate-400 leading-none mb-1">{currentDay}요일</div>
              <div className="text-2xl font-mono font-bold text-slate-700 tracking-tighter tabular-nums">
                {currentTime.toLocaleTimeString('ko-KR', { hour12: false })}
              </div>
            </div>
            <button 
              onClick={() => setShowAdminPanel(!showAdminPanel)}
              className={`p-3 rounded-xl transition-all shadow-md ${showAdminPanel ? 'bg-slate-800 text-white' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}
              title="관리자 설정"
            >
              <Settings size={22} />
            </button>
          </div>
        </header>

        {/* Admin Panel */}
        <AnimatePresence>
          {showAdminPanel && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-2 gap-6"
            >
              {/* Excel Upload Panel */}
              <div className="bg-amber-50 border-2 border-dashed border-amber-200 rounded-3xl p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-amber-900 flex items-center gap-2">
                    <Upload className="text-amber-500" />
                    ⚙️ 엑셀 통합 시간표 업로드
                  </h3>
                </div>
                <div className="bg-white/60 p-6 rounded-2xl border border-amber-100 space-y-4">
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    accept=".xlsx, .xls"
                    className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-amber-100 file:text-amber-700 hover:file:bg-amber-200 cursor-pointer"
                  />
                  <button 
                    onClick={handleFileUpload}
                    disabled={isUploading}
                    className="w-full bg-slate-800 hover:bg-slate-900 disabled:bg-slate-400 text-white py-4 rounded-xl font-bold shadow-xl shadow-slate-200 transition-all active:scale-[0.98]"
                  >
                    클라우드 실시간 동기화 시작
                  </button>
                    {uploadStatus.message && (
                    <div className={`p-4 rounded-xl text-sm font-bold flex items-center gap-3 ${
                        uploadStatus.type === 'loading' ? 'bg-blue-100 text-blue-800' :
                        uploadStatus.type === 'success' ? 'bg-emerald-100 text-emerald-800' :
                        'bg-red-100 text-red-800'
                    }`}>
                        {uploadStatus.type === 'loading' && <div className="w-4 h-4 border-2 border-blue-800 border-t-transparent rounded-full animate-spin" />}
                        {uploadStatus.message}
                    </div>
                    )}
                </div>
                <p className="text-amber-800/60 text-xs font-medium px-2">
                  * 전용 서식 엑셀 파일을 업로드하면 즉시 모든 사용자의 화면이 갱신됩니다.
                </p>
              </div>

              {/* Manual Override Panel */}
              <div className="bg-blue-50 border-2 border-dashed border-blue-200 rounded-3xl p-8 space-y-6">
                <h3 className="text-xl font-bold text-blue-900 flex items-center gap-2">
                  <PlayCircle className="text-blue-500" />
                  ✍️ 개별 프로그램실 수동 제어
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-blue-400 ml-1">방 선택</label>
                    <select 
                      value={manualRoom} 
                      onChange={(e) => setManualRoom(e.target.value)}
                      className="w-full bg-white border border-blue-100 px-4 py-3 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-400 transition-all"
                    >
                      {ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-blue-400 ml-1">상태 선택</label>
                    <select 
                      value={manualStatusType}
                      onChange={(e) => setManualStatusType(e.target.value as any)}
                      className="w-full bg-white border border-blue-100 px-4 py-3 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-400 transition-all"
                    >
                      <option value="auto">자동 (시간표)</option>
                      <option value="available">강제 비움</option>
                      <option value="in-use">수동 입력 (운영중)</option>
                    </select>
                  </div>
                </div>

                {manualStatusType === 'in-use' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in zoom-in-95 duration-200">
                    <input 
                      type="text" 
                      placeholder="프로그램명" 
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      className="bg-white border border-blue-100 px-4 py-3 rounded-xl font-medium outline-none focus:ring-2 focus:ring-blue-400"
                    />
                    <input 
                      type="text" 
                      placeholder="시간 (예: 14:00~15:00)" 
                      value={manualTime}
                      onChange={(e) => setManualTime(e.target.value)}
                      className="bg-white border border-blue-100 px-4 py-3 rounded-xl font-medium outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                )}

                <button 
                  onClick={handleManualSet}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-bold shadow-xl shadow-blue-200 transition-all active:scale-[0.98]"
                >
                  수동 상태 적용하기
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dashboard Grid */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {roomStatus.map((status, idx) => (
            <motion.div
              layout
              key={status.roomName}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className={`relative overflow-hidden group bg-white p-6 rounded-[2rem] border-2 transition-all duration-300 shadow-sm hover:shadow-xl hover:-translate-y-1 ${
                status.isActive ? 'border-blue-500 ring-4 ring-blue-500/10' : 'border-slate-100'
              }`}
            >
              <div className="flex justify-between items-start mb-6">
                <div className="flex flex-col">
                  <span className={`text-[10px] font-black uppercase tracking-widest mb-1 ${status.isActive ? 'text-blue-500' : 'text-slate-400 text-[9px]'}`}>
                    {status.source}
                  </span>
                  <div className="flex items-center gap-2">
                    <MapPin size={14} className={status.isActive ? 'text-blue-400' : 'text-slate-400'} />
                    <h2 className="text-xl font-black text-slate-800 tracking-tight">{status.roomName}</h2>
                  </div>
                </div>
                {status.isActive ? (
                  <div className="bg-blue-500 p-2 rounded-full text-white shadow-lg shadow-blue-200 animate-pulse">
                    <PlayCircle size={20} />
                  </div>
                ) : (
                  <div className="bg-slate-100 p-2 rounded-full text-slate-300">
                    <CheckCircle2 size={20} />
                  </div>
                )}
              </div>

              <div className={`p-6 rounded-[1.5rem] transition-colors duration-500 flex flex-col items-center text-center gap-3 ${
                status.isActive ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-400'
              }`}>
                {status.isActive ? (
                  <>
                    <span className="text-sm font-black uppercase tracking-tighter opacity-80">운영 중</span>
                    <div className="space-y-1">
                      <div className="text-lg font-bold leading-tight line-clamp-2">{status.progName}</div>
                      <div className="text-xs font-mono opacity-80">{status.progTime}</div>
                    </div>
                  </>
                ) : (
                  <span className="text-lg font-black tracking-tight">사용 가능</span>
                )}
              </div>
            </motion.div>
          ))}
        </section>

        {/* Data Inspection Section */}
        <div className="pt-8 space-y-6 text-center">
            <button 
              onClick={() => setShowTimetable(!showTimetable)}
              className="group inline-flex items-center gap-3 bg-slate-100 hover:bg-slate-800 hover:text-white text-slate-600 px-8 py-4 rounded-2xl font-black transition-all shadow-lg active:scale-95"
            >
              <Database size={20} className={showTimetable ? 'text-blue-400' : 'text-slate-400'} />
              👀 클라우드 전체 데이터 검수하기
              {showTimetable ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>

          <AnimatePresence>
            {showTimetable && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden mt-6"
              >
                <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden max-w-4xl mx-auto">
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-slate-800 text-white text-[11px] font-black uppercase tracking-wider">
                          <th className="py-4 px-6 text-left">방 이름</th>
                          <th className="py-4 px-6 text-center">요일</th>
                          <th className="py-4 px-6 text-center">운영 시간</th>
                          <th className="py-4 px-6 text-left">프로그램명</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Object.entries(scheduleData) as [string, ScheduleItem[]][]).flatMap(([room, progs]) => 
                          progs.map((p, i) => (
                            <tr key={`${room}-${i}`} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors text-slate-600">
                              <td className="py-4 px-6 font-bold text-slate-700">{room}</td>
                              <td className="py-4 px-6 text-center">
                                <span className="inline-block px-2 py-1 rounded-md bg-slate-100 text-slate-600 font-bold text-xs uppercase">{p.day}</span>
                              </td>
                              <td className="py-4 px-6 text-center text-xs font-mono font-medium">
                                {p.start} ~ {p.end}
                              </td>
                              <td className="py-4 px-6 text-sm font-semibold">{p.name}</td>
                            </tr>
                          ))
                        )}
                        {(Object.values(scheduleData) as ScheduleItem[][]).every(progs => progs.length === 0) && (
                          <tr>
                            <td colSpan={4} className="py-12 text-center text-slate-400 italic">
                              데이터가 없습니다. 엑셀 파일을 업로드해주세요.
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

      </div>
    </div>
  );
}
