import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { LayoutDashboard, GitBranch, FileText, Tag, ScrollText, Network, Eye, ListFilter, PenLine, MessageSquare, Database } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Pipeline from './pages/Pipeline'
import Transcripts from './pages/Transcripts'
import Issues from './pages/Issues'
import Logs from './pages/Logs'
import ClassificationLogs from './pages/ClassificationLogs'
import TaxonomyLog from './pages/taxonomy/TaxonomyLog'
import ProcessTopics from './pages/taxonomy/ProcessTopics'
import ReviewTopics from './pages/taxonomy/ReviewTopics'
import ViewTopics from './pages/taxonomy/ViewTopics'
import WeaviateSetup from './pages/config/WeaviateSetup'
import Prompts from './pages/config/Prompts'

const PHASE1_NAV = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
]

const PIPELINE_NAV = [
  { path: '/pipeline', label: 'Pipeline', icon: GitBranch },
  { path: '/transcripts', label: 'Transcripts', icon: FileText },
  { path: '/issues', label: 'Issues', icon: Tag },
]

const AUDIT_NAV = [
  { path: '/logs', label: 'Extraction Log', icon: ScrollText },
  { path: '/classification-logs', label: 'Classification Log', icon: ListFilter },
  { path: '/taxonomy-log', label: 'Taxonomy Log', icon: FileText },
]

const TAXONOMY_NAV = [
  { path: '/taxonomy/process', label: 'Process Topics', icon: Network },
  { path: '/taxonomy/review', label: 'Review Topics', icon: PenLine },
  { path: '/taxonomy/view', label: 'View Topics', icon: Eye },
]

const CONFIG_NAV = [
  { path: '/config/weaviate', label: 'Weaviate Setup', icon: Database },
  { path: '/config/prompts', label: 'Prompts', icon: MessageSquare },
]

function NavItem({ path, label, icon: Icon, indent = false }) {
  return (
    <NavLink
      to={path}
      end={path === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${indent ? 'pl-6' : ''} ${
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        }`
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </NavLink>
  )
}

function SectionLabel({ label }) {
  return (
    <div className="pt-6 pb-1">
      <div className="px-3 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">{label}</div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-background">
        <aside className="w-56 shrink-0 border-r border-border bg-card flex flex-col">
          <div className="px-6 py-5 border-b border-border">
            <div className="text-base font-semibold">Taxonomy</div>
            <div className="text-xs text-muted-foreground mt-0.5">Classification System</div>
          </div>
          <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
            {PHASE1_NAV.map(item => <NavItem key={item.path} {...item} />)}

            <SectionLabel label="Pipeline" />
            {PIPELINE_NAV.map(item => <NavItem key={item.path} {...item} indent />)}

            <SectionLabel label="Taxonomy" />
            {TAXONOMY_NAV.map(item => <NavItem key={item.path} {...item} indent />)}

            <SectionLabel label="Audit Logs" />
            {AUDIT_NAV.map(item => <NavItem key={item.path} {...item} indent />)}

            <SectionLabel label="Configuration" />
            {CONFIG_NAV.map(item => <NavItem key={item.path} {...item} indent />)}
          </nav>
        </aside>

        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/transcripts" element={<Transcripts />} />
            <Route path="/issues" element={<Issues />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/classification-logs" element={<ClassificationLogs />} />
            <Route path="/taxonomy-log" element={<TaxonomyLog />} />
            <Route path="/taxonomy/process" element={<ProcessTopics />} />
            <Route path="/taxonomy/review" element={<ReviewTopics />} />
            <Route path="/taxonomy/view" element={<ViewTopics />} />
            <Route path="/config/weaviate" element={<WeaviateSetup />} />
            <Route path="/config/prompts" element={<Prompts />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
