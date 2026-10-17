import React, {useState} from 'react';
import {api} from '../api.js';
import {useApp} from '../context.js';
import {ErrorBox, Field, Spinner, useLoad} from './ui.jsx';
import {canonicalMoveFilter, replaySearchHref} from '../history-search.js';
import {nameOf} from '../battle/dex.js';

const EMPTY = {species:'', move:'', trainer:'', format:'', result:'', mode:''};

export default function BattleSearch({kind, renderBattle, onActive}) {
  const {t, lang} = useApp();
  const [draft, setDraft] = useState(EMPTY);
  const [submitted, setSubmitted] = useState(null);
  const [offset, setOffset] = useState(0);
  const [searchRun, setSearchRun] = useState(0);
  const request = submitted ? {...submitted, kind, offset, limit:20} : null;
  const queryKey = JSON.stringify([request, searchRun]);
  const {data, error, loading, reload} = useLoad(async () => request ? {...await api.call('battles_search', request), queryKey} : null, [queryKey]);
  const current = data?.queryKey === queryKey ? data : null;
  const set = (key, value) => setDraft(old=>({...old,[key]:value,...(key==='trainer' && !value.trim() && ['won','lost'].includes(old.result) ? {result:''} : {})}));
  const search = e => {
    e.preventDefault();
    setOffset(0);
    setSubmitted({...draft, move:canonicalMoveFilter(draft.move)});
    setSearchRun(n=>n+1);
    onActive(true);
  };
  const clear = () => { setDraft(EMPTY); setSubmitted(null); setOffset(0); onActive(false); };
  const moment = (battle, match, index) => <a className="btn btn-sm max-w-full whitespace-normal text-left" key={index} href={replaySearchHref(battle.id,battle.mode,match)}>
    {battle.mode==='realtime' ? t('hs_seconds',{n:match.seconds}) : t('hs_turn',{n:match.turn})}
    {match.species && ` · ${match.species}`}{match.move && ` · ${nameOf('move',match.move,lang)}`}
  </a>;
  return <section className="space-y-3" aria-label={t('hs_title')}>
    <form className="panel space-y-3" onSubmit={search}>
      <div><h2>{t('hs_title')}</h2><p className="help">{t('hs_help')}</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {['species','move','trainer','format'].map(key=><Field key={key} label={t(`hs_${key}`)}>
          <input className="field" value={draft[key]} maxLength={key==='trainer'?160:100} onChange={e=>set(key,e.target.value)} placeholder={t(`hs_${key}_example`)} />
        </Field>)}
        <Field label={t('hs_result')}><select className="field" value={draft.result} onChange={e=>set('result',e.target.value)}>
          {['','p1','p2','tie','won','lost'].map(value=><option key={value} value={value} disabled={['won','lost'].includes(value) && !draft.trainer.trim()}>{t(`hs_result_${value || 'all'}`)}</option>)}
        </select></Field>
        <Field label={t('hs_mode')}><select className="field" value={draft.mode} onChange={e=>set('mode',e.target.value)}>
          {['','classic','realtime'].map(value=><option key={value} value={value}>{t(`hs_mode_${value || 'all'}`)}</option>)}
        </select></Field>
      </div>
      <div className="flex flex-wrap gap-2"><button className="btn btn-primary" type="submit" disabled={loading && !!submitted}>{t('hs_search')}</button><button className="btn" type="button" onClick={clear}>{t('hs_clear')}</button></div>
    </form>
    {submitted && <div className="space-y-3" aria-live="polite" aria-busy={loading}>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !current ? <Spinner /> : current && <>
        <p className="help">{t('hs_counts',{n:current.total, searched:current.coverage.searched})}</p>
        {!!current.coverage.without_replay && <p className="help">{t('hs_missing',{n:current.coverage.without_replay})}</p>}
        {!!current.coverage.ambiguous_events && <p className="help">{t('hs_ambiguous',{n:current.coverage.ambiguous_events})}</p>}
        {!current.battles.length && <div className="panel"><h3>{t('hs_empty')}</h3><p className="help">{t('hs_empty_help')}</p></div>}
        {current.battles.map(({battle, matches, match_count})=><div className="panel p-0" key={battle.id}>
          {renderBattle(battle)}
          <div className="flex flex-wrap gap-2 border-t border-[var(--line)] p-3">
            {matches.slice(0,6).map((match,index)=>moment(battle,match,index))}
            {matches.length>6 && <details className="w-full"><summary className="cursor-pointer help">{t('hs_more_matches',{n:match_count-6})}</summary>
              <div className="mt-2 flex flex-wrap gap-2">{matches.slice(6).map((match,index)=>moment(battle,match,index+6))}</div>
            </details>}
          </div>
        </div>)}
        <div className="flex flex-wrap gap-2">
          {offset>0 && <button className="btn" type="button" onClick={()=>setOffset(Math.max(0,offset-20))}>{t('hs_previous')}</button>}
          {current.next_offset!==null && <button className="btn" type="button" onClick={()=>setOffset(current.next_offset)}>{t('hs_next')}</button>}
        </div>
      </>}
    </div>}
  </section>;
}
