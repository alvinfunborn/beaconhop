#!/usr/bin/env python3
"""Run only against our two local fixture windows and a debug BeaconHop instance.
Usage: python3 scripts/macos-qa.py [iterations] [--extended]. Artifacts stay in ignored logs/.
Requires Accessibility permission for the fixture/key helper and BeaconHop.
"""
import json, pathlib, subprocess, time, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
LOG = ROOT / 'logs'
def read(name):
    for _ in range(20):
        try: return json.loads((LOG / name).read_text())
        except (json.JSONDecodeError, FileNotFoundError): time.sleep(.05)
    raise RuntimeError('Missing or incomplete diagnostic file: ' + name)
def wait(fn, description, timeout=8):
    start=time.monotonic()
    while time.monotonic()-start<timeout:
        value=fn()
        if value: return value
        time.sleep(.04)
    raise AssertionError(description)
def run(name,*args):
    subprocess.run([str(LOG/name),*map(str,args)],check=True,capture_output=True,timeout=8)
def key(*args):run('macos-key',*args)
def probe():return read('native-diagnostics.json')
def state():return read('fixture-state.json')
def mode(wanted):return wait(lambda:probe()['sessionMode']==wanted,'Expected mode '+wanted)
fixture=state();pid=fixture['pid'];a,b=[w['id'] for w in fixture['windows']]
ids={i:f'mac:{pid}:{i}' for i in [a,b]};baseline={w['id']:w['text'] for w in fixture['windows']}
results=[]
created_fullscreen=False
def focused(i):return any(w['id']==i and w['key'] for w in state()['windows'])
def focus(i):
    run('macos-window',pid,'focus',i)
    wait(lambda:focused(i),'Fixture focus failed')
    wait(lambda:probe()['focusedId']==ids[i],'Inventory focus did not converge')
def held():
    key(58,'down',524288,48,'down',524288,48,'up',524288);mode('held')
def hint(i):
    code=wait(lambda:next((w['hint'] for w in probe()['hints'] if w['id']==ids[i]),None),'Missing fixture hint')
    codes=dict(zip('ASDFGHJKLQWERTYUIOPZXCVBNM',[0,1,2,3,5,4,38,40,37,12,13,14,15,17,16,32,34,31,35,6,7,8,9,11,45,46]))
    events=[]
    for c in code:events.extend([codes[c],'down',524288,codes[c],'up',524288])
    key(*events)
def unchanged():
    assert all(w['text']==baseline[w['id']] for w in state()['windows']),'A shortcut or hint leaked into the target text field'
def record(name,start):
    unchanged();results.append({'case':name,'confirmationMs':round((time.monotonic()-start)*1000)})
    (LOG/'macos-qa-progress.json').write_text(json.dumps(results,indent=2))
try:
    assert probe()['permissions']['ready'],'BeaconHop native permissions are not ready'
    rows=[w for w in probe()['windows'] if w['pid']==pid]
    assert len(rows)==2,'Both fixture windows must be inventoried'
    if len(probe()['displays'])>1: assert len({w['displayId'] for w in rows})==2,'Fixtures must be on separate displays'
    for n in range(int(sys.argv[1]) if len(sys.argv)>1 else 10):
        focus(a);focus(b);held()
        assert probe()['selected']==ids[a], 'Held mode did not select the previous window'
        start=time.monotonic();key(58,'up',0);wait(lambda:focused(a),'Modifier release did not focus A');mode('inactive');record('release-to-previous',start)
        held();start=time.monotonic();hint(b);wait(lambda:focused(b),'Hint did not focus B before modifier release');mode('inactive');unchanged();key(58,'up',0);record('immediate-hint',start)
    focus(a);held();key(42,'down',524288,42,'up',524288,58,'up',0);mode('search');time.sleep(.3);mode('search')
    start=time.monotonic();key('--text','BeaconHop QA B');time.sleep(.3);key(36,'down',0,36,'up',0);wait(lambda:focused(b),'Search did not focus B');mode('inactive');record('backslash-persistent-search',start)
    focus(a);key(55,'down',1048576,50,'down',1048576,50,'up',1048576,55,'up',0);mode('search')
    start=time.monotonic();key('--text','BeaconHop QA B');time.sleep(.3);key(36,'down',0,36,'up',0);wait(lambda:focused(b),'Direct search did not focus B');mode('inactive');record('direct-search',start)
    focus(a);held();key(42,'down',524288,42,'up',524288,58,'up',0);mode('search');start=time.monotonic();key(53,'down',0,53,'up',0);mode('inactive');wait(lambda:focused(a),'Escape did not restore origin');record('escape-restores-origin',start)
    run('macos-window',pid,'minimize',b);wait(lambda:any(w['id']==ids[b] and w['minimized'] for w in probe()['windows']),'Minimized window not inventoried')
    focus(a);held();start=time.monotonic();hint(b);wait(lambda:focused(b),'Minimized window did not restore');mode('inactive');key(58,'up',0);assert not next(w['mini'] for w in state()['windows'] if w['id']==b);record('restore-minimized',start)
    if '--extended' in sys.argv:
        focus(a);(LOG/'fixture-state.json.command').write_text('hide')
        wait(lambda:len([w for w in probe()['windows'] if w['pid']==pid and w['hidden']])==2,'Hidden fixture windows disappeared')
        held();start=time.monotonic();hint(b);wait(lambda:focused(b),'Hidden B did not restore');mode('inactive');key(58,'up',0);record('restore-hidden',start)
        assert not state()['windows'][1]['fullscreen'],'Fixture B must begin windowed'
        created_fullscreen=True;(LOG/'fixture-state.json.command').write_text('fullscreen-b')
        wait(lambda:state()['windows'][1]['fullscreen'],'Fullscreen did not start',15)
        wait(lambda:len({w['desktopId'] for w in probe()['windows'] if w['pid']==pid})==2,'Fullscreen desktop membership',15)
        # The helper's AXWindows list is current-Space-only. Return through
        # BeaconHop, whose cached AX root can reach the other Space.
        held();hint(a);wait(lambda:focused(a),'Fullscreen setup could not return to A');mode('inactive');key(58,'up',0)
        before={w['id']:w['desktopId'] for w in probe()['windows'] if w['pid']==pid}
        held();start=time.monotonic();hint(b);wait(lambda:focused(b),'Fullscreen B focus');mode('inactive');key(58,'up',0)
        wait(lambda:any(w['id']==ids[b] and w['currentDesktop'] for w in probe()['windows']),'Fullscreen Space not active');record('enter-fullscreen-space',start)
        held();start=time.monotonic();hint(a);wait(lambda:focused(a),'Return from fullscreen');mode('inactive');key(58,'up',0)
        assert before=={w['id']:w['desktopId'] for w in probe()['windows'] if w['pid']==pid},'Switching moved a window to another desktop'
        record('leave-fullscreen-space-without-moving-windows',start)
    report={'passed':True,'cases':results,'displays':len(probe()['displays']),'fixturePid':pid,'note':'Synthetic native keys; confirmation includes helper and polling overhead, not input-to-paint latency.'}
    (LOG/'macos-qa.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
finally:
    # Cancel before releasing Alt: releasing first could commit an unrelated MRU
    # target when an assertion fails while the panel is held open.
    if probe()['sessionMode']=='held':
        key(53,'down',524288,53,'up',524288)
        mode('inactive')
    key(58,'up',0,55,'up',0)
    if probe()['sessionMode']=='search':
        key(53,'down',0,53,'up',0)
        mode('inactive')
    if created_fullscreen and state()['windows'][1]['fullscreen']:
        (LOG/'fixture-state.json.command').write_text('fullscreen-b')
