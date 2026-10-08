import {readFileSync,writeFileSync} from 'node:fs'
const p='src/screens/shared/Shared.tsx';let s=readFileSync(p,'utf8')
s=s.replace("  const reports = useAsync(() => (allowed ? api.listReports() : Promise.resolve([])), [allowed])",`  const reports = useAsync(() => (allowed ? api.listReports() : Promise.resolve([])), [allowed])
  const health=useAsync(()=>allowed?api.getAdminHealth():Promise.resolve(null),[allowed])
  const [subject,setSubject]=useState('')
  const [reason,setReason]=useState('')`)
s=s.replace('        <SectionTitle>Verification queue ({pending.length})</SectionTitle>',`        <SectionTitle>Pilot operations</SectionTitle>
        {health.error&&<ErrorState message={health.error.message} onRetry={health.retry}/>}
        {health.data&&<Card><p>{health.data.pendingDocuments} pending documents · {health.data.openReports} open reports · {health.data.suspendedUsers} suspended accounts</p>
         <p className="small muted">Push: {health.data.notifications.providerConfigured?'Configured':'Firebase configuration required'} · {health.data.notifications.pending} pending · {health.data.notifications.failed} failed · {health.data.notifications.delivered} delivered</p>
         {health.data.jobs.map(j=><p className="small" key={j.name}>{j.name}: {j.status}{j.lastRun?' · '+j.lastRun:''}</p>)}
         <TextButton onClick={health.retry}>Refresh job health</TextButton>
        </Card>}
        <Card style={{marginTop:12}}><TextField label="Account ID" value={subject} onChange={setSubject}/><TextField label="Safety reason" value={reason} onChange={setReason}/>
          <div className="row-flex">{[true,false].map(suspended=><SecondaryButton key={String(suspended)} tone={suspended?'danger':undefined} disabled={!subject||(!reason&&suspended)} onClick={async()=>{try{await api.suspendUser(subject,suspended,reason);health.retry();toast(suspended?'Account suspended':'Account restored','success')}catch(e){toast(e instanceof Error?e.message:'Could not update account','error')}}}>{suspended?'Suspend':'Restore'}</SecondaryButton>)}</div>
        </Card>
        <SectionTitle>Verification queue ({pending.length})</SectionTitle>`)
s=s.replace('                <p className="small" style={{ margin:', '                <p className="small muted">Reported by {r.reporterName??r.reporterId??\'Member\'}{r.subjectId?\' · Subject: \'+(r.subjectName??r.subjectId):\'\'}</p>\n                {r.subjectId&&<TextButton onClick={()=>setSubject(r.subjectId!)}>Review this account</TextButton>}\n                <p className="small" style={{ margin:')
s=s.replace("await api.updateReport(r.id, 'reviewing').catch(() => {}); reports.retry()","try{await api.updateReport(r.id,'reviewing');reports.retry()}catch(e){toast(e instanceof Error?e.message:'Could not update','error')}").replace("await api.updateReport(r.id, 'closed').catch(() => {}); reports.retry()","try{await api.updateReport(r.id,'closed');reports.retry()}catch(e){toast(e instanceof Error?e.message:'Could not update','error')}")
s=s.replace('      setHidden((h) => [...h, open.id])','      setHidden((h) => [...h, open.id]);health.retry();docs.retry()')
writeFileSync(p,s)
