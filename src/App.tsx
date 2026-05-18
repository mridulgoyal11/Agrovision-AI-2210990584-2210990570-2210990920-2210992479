import React, { useState, useEffect } from "react";

export default function LeadMovementTracker() {
  // Assignment header fields
  const [name, setName] = useState("");
  const [roleApplied, setRoleApplied] = useState("Business Analyst");
  const [rollNo, setRollNo] = useState("");

  const [leads, setLeads] = useState<any[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [stuckThresholdDays, setStuckThresholdDays] = useState(7);
  const [isLoading, setIsLoading] = useState(false);

  // Basic CSV parser
  function parseCSV(text: string) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return [];
    const headers = lines[0].split(",").map((h) => h.trim());
    const rows = lines.slice(1).map((l) => {
      const parts = l.split(",");
      const obj: any = {};
      headers.forEach((h, i) => (obj[h] = (parts[i] || "").trim()));
      return obj;
    });
    return rows;
  }

  // Try to extract a date from the "Notes" text
  function extractDateFromNotes(notes: string | undefined) {
    if (!notes) return null;
    const iso = notes.match(/(\d{4}-\d{2}-\d{2})/);
    if (iso) return new Date(iso[1]);
    const dmy = notes.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
    if (dmy) {
      const parts = dmy[1].split(/[\/\-]/);
      let dd = Number(parts[0]);
      let mm = Number(parts[1]) - 1;
      let yy = Number(parts[2]);
      if (yy < 100) yy += 2000;
      return new Date(yy, mm, dd);
    }
    const long = notes.match(/([A-Za-z]{3,9} \d{1,2},? \d{4})/);
    if (long) return new Date(long[1]);
    return null;
  }

  // Normalize and enrich leads with inferred fields
  function enrichLeads(raw: any[], uploadedFileModified?: number) {
    const now = new Date();
    return raw.map((r, idx) => {
      const LeadID = r["Lead ID"] || r["lead_id"] || r["id"] || r["LeadID"] || `L-${idx + 1}`;
      const Counselor = r["Counselor"] || r["counselor"] || r["Agent"] || "Unknown";
      const Stage = r["Stage"] || r["stage"] || r["Status"] || r["status"] || "Stage 1";
      const Notes = r["Notes"] || r["notes"] || "";
      const Country = r["Country"] || r["country"] || "Unknown";
      const FeeInterest = r["Fee Interest"] || r["fee interest"] || r["Fee"] || "-";
      const Status = r["Status"] || r["status"] || r["CurrentStatus"] || "Open";

      const inferredFromNotes = extractDateFromNotes(Notes);
      const StageUpdateDate = inferredFromNotes || (uploadedFileModified ? new Date(uploadedFileModified) : now);
      const LastConversationDate = inferredFromNotes || StageUpdateDate;

      return {
        LeadID,
        Counselor,
        Stage,
        Notes,
        Country,
        FeeInterest,
        Status,
        StageUpdateDate,
        LastConversationDate,
      };
    });
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setIsLoading(true);
    setFileName(f.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const raw = parseCSV(text);
      const enriched = enrichLeads(raw, f.lastModified);
      setLeads(enriched);
      setIsLoading(false);
    };
    reader.readAsText(f);
  }

  // Quick sample data generator
  function generateSampleData(n = 200) {
    setIsLoading(true);
    setTimeout(() => {
      const stages = ["Stage 1", "Stage 2", "Stage 3", "Enrollment"];
      const counselors = ["Anita", "Rohit", "Suresh", "Priya", "Aman"];
      const sample: any[] = [];
      const now = Date.now();
      for (let i = 0; i < n; i++) {
        const stage = stages[Math.floor(Math.random() * stages.length)];
        const counselor = counselors[Math.floor(Math.random() * counselors.length)];
        const daysAgo = Math.floor(Math.random() * 30);
        const stageDate = new Date(now - daysAgo * 24 * 60 * 60 * 1000);
        sample.push({
          "Lead ID": `SMP-${i + 1}`,
          Counselor: counselor,
          Stage: stage,
          Notes: `Auto-generated sample. Last talked on ${stageDate.toISOString().slice(0, 10)} about course interest.`,
          Country: Math.random() > 0.7 ? "Nepal" : "India",
          "Fee Interest": ["<5000", "5k-10k", ">10k"][Math.floor(Math.random() * 3)],
          Status: stage === "Enrollment" ? "Enrolled" : "Open",
          _meta: { stageDate: stageDate.getTime() },
        });
      }
      const enriched = enrichLeads(sample, Date.now());
      const withDates = enriched.map((r, i) => ({ ...r, StageUpdateDate: new Date(sample[i]._meta.stageDate) }));
      setLeads(withDates);
      setFileName("(sample data)");
      setIsLoading(false);
    }, 800);
  }

  // Computations for the dashboard
  const totalsByStage = leads.reduce((acc: any, l) => {
    acc[l.Stage] = (acc[l.Stage] || 0) + 1;
    return acc;
  }, {});

  const today = new Date();
  const stuckLeads = leads.filter((l) => {
    const diff = (today.getTime() - new Date(l.StageUpdateDate).getTime()) / (1000 * 60 * 60 * 24);
    return diff > stuckThresholdDays;
  });

  // Conversion % by counselor
  const byCounselor = leads.reduce((acc: any, l) => {
    const c = l.Counselor || "Unknown";
    acc[c] = acc[c] || { total: 0, enrolled: 0 };
    acc[c].total += 1;
    if ((l.Status || "").toLowerCase() === "enrolled") acc[c].enrolled += 1;
    return acc;
  }, {});

  // Funnel insights
  function funnelInsights() {
    const stageOrder = ["Stage 1", "Stage 2", "Stage 3", "Enrollment"];
    const counts = stageOrder.map((s) => totalsByStage[s] || 0);
    const leaks: string[] = [];
    for (let i = 0; i < counts.length - 1; i++) {
      const from = counts[i] || 0;
      const to = counts[i + 1] || 0;
      const drop = from === 0 ? 0 : ((from - to) / from) * 100;
      leaks.push(`${stageOrder[i]} → ${stageOrder[i + 1]}: ${drop.toFixed(1)}% drop`);
    }
    return leaks;
  }

  // Export report as CSV
  function exportReport() {
    const rows = leads.map((l) => ({
      LeadID: l.LeadID,
      Counselor: l.Counselor,
      Stage: l.Stage,
      Status: l.Status,
      StageUpdateDate: new Date(l.StageUpdateDate).toISOString().slice(0, 10),
      LastConversationDate: new Date(l.LastConversationDate).toISOString().slice(0, 10),
      Notes: l.Notes,
    }));
    const header = Object.keys(rows[0] || {}).join(",") + "\n";
    const body = rows.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const csv = header + body;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "edoofa_lead_report.csv";
    a.click();
  }

  // Stage colors for visualization
  const stageColors = {
    "Stage 1": "bg-blue-100 text-blue-800",
    "Stage 2": "bg-purple-100 text-purple-800",
    "Stage 3": "bg-amber-100 text-amber-800",
    "Enrollment": "bg-green-100 text-green-800"
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-300 p-4 md:p-6 text-gray-800">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 flex items-center gap-2">
                <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  Edoofa Lead Movement Tracker
                </span>
              </h1>
              <p className="text-gray-600 mt-1">Track, analyze, and optimize your lead conversion funnel</p>
            </div>
            
            <div className="bg-gray-50 p-3 rounded-lg flex flex-col gap-2 w-full md:w-auto">
              <div className="flex items-center gap-2">
                <input 
                  className="px-3 py-2 rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm w-full" 
                  placeholder="Your Name" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                />
              </div>
              <div className="flex gap-2">
                <input 
                  className="px-3 py-2 rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm flex-1" 
                  placeholder="Role Applied" 
                  value={roleApplied} 
                  onChange={(e) => setRoleApplied(e.target.value)} 
                />
                <input 
                  className="px-3 py-2 rounded border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm w-28" 
                  placeholder="Roll No" 
                  value={rollNo} 
                  onChange={(e) => setRollNo(e.target.value)} 
                />
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Data Input & KPIs */}
          <div className="lg:col-span-2 space-y-6">
            {/* Data Input Card */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-2 sm:mb-0">Data Input</h2>
                <div className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                  {fileName ? `Loaded: ${fileName}` : "No file loaded"}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col items-center justify-center bg-blue-50 hover:bg-blue-100 border-2 border-dashed border-blue-200 rounded-lg p-4 cursor-pointer transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <span className="text-sm text-blue-600 font-medium">Upload CSV</span>
                  <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                </label>

                <button 
                  onClick={() => generateSampleData(200)} 
                  className="flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg p-4 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="text-sm text-gray-700 font-medium">Generate Sample Data</span>
                </button>

                <button 
                  onClick={exportReport} 
                  className="flex flex-col items-center justify-center bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg p-4 transition-colors"
                  disabled={leads.length === 0}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span className="text-sm text-green-700 font-medium">Export Report</span>
                </button>

                <div className="flex flex-col bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <label className="text-xs text-gray-500 mb-1">Stuck Threshold (days)</label>
                  <input 
                    type="number" 
                    className="bg-white border border-gray-300 rounded px-3 py-1 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" 
                    value={stuckThresholdDays} 
                    onChange={(e) => setStuckThresholdDays(Number(e.target.value))} 
                  />
                </div>
              </div>

              {isLoading && (
                <div className="mt-4 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                  <span className="ml-2 text-gray-600">Processing data...</span>
                </div>
              )}

              <div className="mt-6 pt-4 border-t border-gray-100">
                <h3 className="font-medium text-gray-900 mb-2">Data Processing Logic</h3>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li className="flex items-start">
                    <span className="text-blue-500 mr-2">•</span>
                    <span>StageUpdateDate is inferred from date patterns in counselor notes</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-500 mr-2">•</span>
                    <span>If no dates found in notes, the file modification date is used</span>
                  </li>
                  <li className="flex items-start">
                    <span className="text-blue-500 mr-2">•</span>
                    <span>Leads inactive for more than threshold days are flagged as stuck</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Funnel Overview Card */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Funnel Overview</h2>
              
              {Object.entries(totalsByStage).length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <p>No data available. Upload a CSV file or generate sample data.</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    {Object.entries(totalsByStage).map(([stage, count]: [string, any]) => (
                      <div key={stage} className="bg-gray-50 rounded-lg p-4 text-center">
                        <div className={`inline-flex items-center justify-center h-10 w-10 rounded-full mb-2 ${stageColors[stage as keyof typeof stageColors] || 'bg-gray-100 text-gray-800'}`}>
                          {count}
                        </div>
                        <div className="text-sm font-medium text-gray-700">{stage}</div>
                      </div>
                    ))}
                  </div>

                  <div>
                    <h3 className="font-medium text-gray-900 mb-2">Conversion Analysis</h3>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <ul className="space-y-2">
                        {funnelInsights().map((s, i) => (
                          <li key={i} className="flex justify-between items-center text-sm">
                            <span className="text-gray-600">{s.split(':')[0]}</span>
                            <span className="font-medium">{s.split(':')[1]}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Stuck Leads Card */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Stuck Leads</h2>
                <span className="bg-red-100 text-red-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
                  {stuckLeads.length} leads
                </span>
              </div>

              {stuckLeads.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-green-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p>No stuck leads found. Great job!</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                  {stuckLeads.slice(0, 10).map((l) => (
                    <div key={l.LeadID} className="bg-red-50 border border-red-100 rounded-lg p-4 hover:bg-red-100 transition-colors">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-gray-900">{l.LeadID}</span>
                            <span className="text-xs text-gray-500">•</span>
                            <span className="text-sm text-gray-700">{l.Counselor}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-gray-600 mb-2">
                            <span className="bg-white px-2 py-0.5 rounded-full">{l.Stage}</span>
                            <span>Last update: {new Date(l.StageUpdateDate).toLocaleDateString()}</span>
                          </div>
                          <p className="text-sm text-gray-700 line-clamp-2">{l.Notes}</p>
                        </div>
                        <button className="bg-white hover:bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-medium ml-2">
                          Escalate
                        </button>
                      </div>
                    </div>
                  ))}
                  {stuckLeads.length > 10 && (
                    <div className="text-center text-sm text-gray-500 mt-2">
                      + {stuckLeads.length - 10} more stuck leads
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Metrics & Conversion */}
          <div className="space-y-6">
            {/* KPIs Card */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Performance Overview</h2>
              <div className="space-y-4">
                <div className="bg-blue-50 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-blue-600 font-medium">Total Leads</div>
                      <div className="text-2xl font-bold text-blue-800">{leads.length}</div>
                    </div>
                    <div className="bg-blue-100 p-2 rounded-full">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="bg-red-50 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-red-600 font-medium">Stuck Leads</div>
                      <div className="text-2xl font-bold text-red-800">{stuckLeads.length}</div>
                      <div className="text-xs text-red-600 mt-1">&gt; {stuckThresholdDays} days inactive</div>
                    </div>
                    <div className="bg-red-100 p-2 rounded-full">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                  </div>
                </div>

                <div className="bg-green-50 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-green-600 font-medium">Active Counselors</div>
                      <div className="text-2xl font-bold text-green-800">{Object.keys(byCounselor).length}</div>
                    </div>
                    <div className="bg-green-100 p-2 rounded-full">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Conversion by Counselor Card */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Conversion by Counselor</h2>
              
              {Object.keys(byCounselor).length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-300 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <p>No conversion data available</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(byCounselor)
                    .sort((a: any, b: any) => (b[1].enrolled / b[1].total) - (a[1].enrolled / a[1].total))
                    .map(([c, vals]: [string, any]) => {
                      const pct = vals.total === 0 ? 0 : (vals.enrolled / vals.total) * 100;
                      return (
                        <div key={c}>
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-medium text-sm text-gray-900">{c}</span>
                            <span className="text-sm font-semibold text-gray-700">{pct.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div 
                              className="bg-green-500 h-2 rounded-full" 
                              style={{ width: `${pct}%` }}
                            ></div>
                          </div>
                          <div className="flex justify-between text-xs text-gray-500 mt-1">
                            <span>{vals.enrolled} enrolled</span>
                            <span>{vals.total} total</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* AI Note Generation Card */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">AI-Generated Handover Notes</h2>
              <div className="text-sm text-gray-600 mb-4">
                For every lead moved to the Sales Leader view, the system auto-generates a student summary including:
              </div>
              
              <ul className="text-sm text-gray-700 space-y-2 mb-4">
                <li className="flex items-center">
                  <span className="bg-blue-100 text-blue-800 rounded-full p-1 mr-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </span>
                  Last Conversation Notes
                </li>
                <li className="flex items-center">
                  <span className="bg-blue-100 text-blue-800 rounded-full p-1 mr-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </span>
                  Course Interest
                </li>
                <li className="flex items-center">
                  <span className="bg-blue-100 text-blue-800 rounded-full p-1 mr-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </span>
                  Parent Objection
                </li>
                <li className="flex items-center">
                  <span className="bg-blue-100 text-blue-800 rounded-full p-1 mr-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </span>
                  Next Action Date
                </li>
              </ul>

              <div className="bg-gray-50 rounded-lg p-4 mt-4">
                <h3 className="font-medium text-gray-900 text-sm mb-2">Example Preview</h3>
                
                {stuckLeads[0] ? (
                  <div className="text-sm">
                    <div className="font-semibold text-gray-900 mb-1">{stuckLeads[0].LeadID} Summary</div>
                    <div className="text-xs text-gray-500 mb-2">Counselor: {stuckLeads[0].Counselor}</div>
                    <p className="text-gray-700 mb-2 line-clamp-3">{stuckLeads[0].Notes}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="font-medium">Course Interest:</span> 
                        {stuckLeads[0].Notes.match(/course interest|interested in (\w+)/i)?.[0] || "(from lead fields)"}
                      </div>
                      <div>
                        <span className="font-medium">Parent Objection:</span> 
                        {(stuckLeads[0].Notes.match(/parent.*?:?\s*([^.;\n]+)/i) || [null, "None"])[1]}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500 text-center py-2">
                    No stuck leads to preview
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <footer className="mt-8 text-center text-sm text-gray-500">
          Prototype built for the Edoofa assignment — add your Name, Role, and Roll No before submission.
        </footer>
      </div>
    </div>
  );
}