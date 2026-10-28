#!/usr/bin/env python3
"""Native edge acceptance using owned fixtures and an isolated debug app profile.
Compile the Swift helpers into logs/ first; see docs/validation.md.
Uses enabled input sources only and restores the selected source on exit.
"""
import json, os, pathlib, subprocess, time, sys
root=pathlib.Path(__file__).resolve().parent.parent
log=root/'logs'; processes=[];results=[];original_source=None; app=None
def read(name):
    for _ in range(100):
        try:return json.loads((log/name).read_text())
        except (OSError,ValueError):time.sleep(.05)
    raise RuntimeError('Missing state '+name)
def wait(fn,description,timeout=10):
    start=time.monotonic()
    while time.monotonic()-start<timeout:
        value=fn()
        if value:return value
        time.sleep(.04)
    raise AssertionError(description)
def run(name,*args):
    return subprocess.check_output([str(log/name),*map(str,args)],timeout=10,text=True).strip()
def key(*args):run('macos-key',*args)
def probe():return read('native-diagnostics.json')
def state():return read('fixture-state.json')
def mode(wanted):wait(lambda:probe()['sessionMode']==wanted,'Expected mode '+wanted)
def field():return json.loads(run('macos-field',app.pid))
def held():key(58,'down',524288,48,'down',524288,48,'up',524288);mode('held')
def open_search():key(55,'down',1048576,50,'down',1048576,50,'up',1048576,55,'up',0);mode('search')
def cancel():
    if probe()['sessionMode']=='held':key(53,'down',524288,53,'up',524288);mode('inactive')
    key(58,'up',0,55,'up',0)
    for _ in range(3):
        if probe()['sessionMode']!='search':break
        key(53,'down',0,53,'up',0);time.sleep(.8)
    mode('inactive')
def focused(i):return any(w['id']==i and w['key'] for w in state()['windows'])
def focus(i):
    run('macos-window',fixture.pid,'focus',i);wait(lambda:focused(i),'Fixture focus')
    wait(lambda:probe()['focusedId']==ids[i],'Focus inventory')
def hint(i):
    value=next(w['hint'] for w in probe()['hints'] if w['id']==ids[i])
    codes=dict(zip('ASDFGHJKLQWERTYUIOPZXCVBNM',[0,1,2,3,5,4,38,40,37,12,13,14,15,17,16,32,34,31,35,6,7,8,9,11,45,46]))
    events=[]
    for c in value:events.extend([codes[c],'down',524288,codes[c],'up',524288])
    key(*events)
def record(name,**detail):
    results.append({'case':name,'passed':True,**detail})
    (log/'macos-edge-qa-progress.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));print(name,flush=True)
try:
    for name in ['fixture-state.json','native-diagnostics.json']:(log/name).unlink(missing_ok=True)
    fixture=subprocess.Popen([str(log/'macos-fixture'),str(log/'fixture-state.json')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);processes.append(fixture)
    env=os.environ.copy();env['BEACONHOP_DATA_DIR']=str(log/'native-profile');env['BEACONHOP_DIAGNOSTICS_FILE']=str(log/'native-diagnostics.json')
    app_log=(log/'edge-app.log').open('w')
    app=subprocess.Popen([str(root/'src-tauri/target/debug/bundle/macos/BeaconHop.app/Contents/MacOS/beaconhop'),'--background'],env=env,stdout=app_log,stderr=app_log);processes.append(app)
    wait(lambda:probe().get('processId')==app.pid and probe()['permissions']['ready'] and len([w for w in probe()['windows'] if w['pid']==fixture.pid])==2,'Fresh native identities / permissions',25)
    a,b=[w['id'] for w in state()['windows']];ids={i:f'mac:{fixture.pid}:{i}' for i in [a,b]}
    baseline=[w['text'] for w in state()['windows']]
    if '--skip-rapid' not in sys.argv:
        rapid=[]
        for _ in range(10):
            focus(a);focus(b)
            result=json.loads(run('macos-fast-switch',fixture.pid,a,b));rapid.append(result)
            assert result['first'] and result['second'],'Rapid MRU toggles failed: '+json.dumps(result)
            mode('inactive');assert [w['text'] for w in state()['windows']]==baseline
        record('rapid-two-toggle-roundtrip',rounds=len(rapid),measurements=rapid)
    (log/'fixture-state.json.command').write_text('same-title')
    wait(lambda:len(set(w['title'] for w in state()['windows']))==1,'Same-title fixture');time.sleep(1.2)
    focus(a);held();hint(b);wait(lambda:focused(b),'Same-title exact focus');mode('inactive');key(58,'up',0)
    assert [w['text'] for w in state()['windows']]==baseline
    record('same-title-distinct-window-hint',target=ids[b])
    focus(a);(log/'fixture-state.json.command').write_text('hide')
    wait(lambda:len([w for w in probe()['windows'] if w['pid']==fixture.pid and w['hidden']])==2,'Hidden fixture inventory')
    held();hint(b);wait(lambda:focused(b),'Hidden target activation across applications');mode('inactive');key(58,'up',0)
    assert [w['text'] for w in state()['windows']]==baseline
    record('hidden-application-exact-target-restore')
    original_source=run('macos-input-source')
    available=json.loads(run('macos-input-source','--list'))
    sources=[s for s in dict.fromkeys([original_source,'com.apple.inputmethod.SCIM.ITABC']) if s in available]
    for source in sources:
        if not ('inputmethod' in source):continue
        focus(a);open_search();run('macos-input-source',source);time.sleep(.4)
        keys=[]
        for code in [45,34,4,0,31]:keys.extend([code,'down',0,code,'up',0])
        key(*keys)
        print('IME preedit',source,field(),flush=True)
        wait(lambda:field()['value'].replace(chr(39),'').replace(' ','')=='nihao','Native IME preedit text')
        wait(lambda:probe()['selected'] in ids.values(),'Preedit must have matching fixture results')
        before=probe()['sessionId'];key(36,'down',0,36,'up',0);time.sleep(.8)
        assert probe()['sessionMode']=='search' and probe()['sessionId']==before,'Composition Enter prematurely activated a result'
        print('IME committed',source,field(),flush=True)
        assert field()['value'].replace(chr(39),'').replace(' ','')=='nihao','Composition Enter must commit pinyin text'
        record('native-ime-enter-commits-without-switch',source=source,committedText=field()['value'])
        key(36,'down',0,36,'up',0);mode('inactive');wait(lambda:any(focused(i) for i in [a,b]),'Second Enter activates a fixture')
        assert [w['text'] for w in state()['windows']]==baseline
        record('native-ime-second-enter-activates',source=source)
        focus(a);open_search();run('macos-input-source',source);time.sleep(.3);key(*keys);key(49,'down',0,49,'up',0)
        wait(lambda:field()['value']=='你好','Native IME Chinese commit')
        wait(lambda:probe()['selected'] in ids.values(),'Chinese search matches fixture')
        selected=probe()['selected'];key(36,'down',0,36,'up',0);mode('inactive');wait(lambda:focused(next(i for i in ids if ids[i]==selected)),'Chinese query exact target')
        assert [w['text'] for w in state()['windows']]==baseline
        record('native-ime-chinese-search',source=source,query='你好',target=selected)
    run('macos-input-source',original_source)
    focus(a);held();old_hints=probe()['hints'];(log/'fixture-state.json.command').write_text('close-b')
    wait(lambda:all(w['id']!=ids[b] for w in probe()['windows']),'Closed target removed from inventory')
    assert probe()['hints']==old_hints,'Hints moved after target closure'
    hint(b);mode('search');key(58,'up',0)
    texts=json.loads(run('macos-field',app.pid,'tree'))['texts']
    assert any('That window has closed' in s for s in texts),'Closed target error not exposed in native UI'
    assert state()['windows'][0]['text']==baseline[0]
    record('target-closes-during-hint-selection',hintsStable=True,errorVisible=True)
    cancel();wait(lambda:focused(a),'Closed target cancel restores origin');record('closed-target-cancel-restores-origin')
    (log/'macos-edge-qa.json').write_text(json.dumps({'passed':True,'cases':results,'native':True,'appPid':app.pid,'fixturePid':fixture.pid},ensure_ascii=False,indent=2))
finally:
    if app is not None and app.poll() is None:
        try:cancel()
        except Exception as e:print('Cleanup cancellation:',e)
    if original_source:
        try:run('macos-input-source',original_source)
        except Exception as e:print('Input source restoration failed:',e)
    for p in reversed(processes):
        if p.poll() is None:
            p.terminate()
            try:p.wait(timeout=6)
            except subprocess.TimeoutExpired:p.kill();p.wait()
