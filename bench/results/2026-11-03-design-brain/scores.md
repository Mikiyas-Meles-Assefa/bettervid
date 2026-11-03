# Bench run 2026-11-03-design-brain

Free measures (0 to 1) and watch tests. "free" is the mean of the free measures; quiz scores are the share right; "picture Qs" are the questions only the picture can answer; "confused" is the share of 2 s windows where the follow viewer reported confusion. Columns are explained in bench/README.md.

| case | use | style | built | free | eye | lag | pace | load | holds | reveal | read | quiz (video) | quiz (words) | picture Qs | follow on look | confused | designer /10 | scroll kept | scroll remembers |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| titration-lab | a lab procedure step, from a handout | chalkboard | yes (0, checks fail) | 0.72 | 0.34 | 0.55 | 0.83 | 0.32 | 1.00 | 1.00 | 0.98 | 1.00 | 1.00 | - | 0.85 | 0.54 | 5 | 1.00 | 1.00 |
| support-tickets | a meeting slide turned into a clip | flat | yes (0, checks fail) | 0.82 | 0.70 | 0.85 | 1.00 | 0.88 | 0.50 | 1.00 | 0.78 | 1.00 | 1.00 | 1.00 | 1.00 | 0.22 | 4 | 0.54 | 1.00 |
| ball-drop | predict, then reveal | chalkboard | yes (0, checks fail) | 0.69 | 0.74 | 0.92 | 0.38 | 0.77 | 0.50 | 1.00 | 0.55 | 1.00 | 0.75 | 1.00 | 0.83 | 0.67 | 3 | 0.08 | 1.00 |
| **all** | | | 3/3 | 0.74 | 0.60 | 0.77 | 0.74 | 0.66 | 0.67 | 1.00 | 0.77 | 1.00 | 0.92 | 1.00 | 0.89 | 0.48 | 4.00 | 0.54 | 1.00 |

## Direction tickets (severity 2 and 3)

- **titration-lab**: demo_unsettled: Phase 1 of e2's demo (fast, 6.5 to 13.4 s) should end on the finished state, but "additions into the flask" is still changing at 13.3 s, 0.00 s before it ends; it never rests on the result. / competing: During e3 (13.4 to 18.1 s) the eye should be on "single drops falling" (drop.burette.0, drop.burette.1, drop.burette.2, drop.burette.7), but only 15% of the change on screen is there; 4 other things pull at it: t.flask for 3.3 s, drop.burette.6 for 1.0 s, t.burette ("0 10 20 30 40 50") for 0.9 s, bloom.flask.0 for 0.3 s. / competing: During e4 (18.1 to 25.3 s) the eye should be 
- **support-tickets**: competing: During e4 (12.5 to 17.5 s) the eye should be on "the login bar, half of the whole" (p.slide), but only 33% of the change on screen is there; 3 other things pull at it: parrow.0.half.login for 0.5 s, t.rest ("160 (shipping and everything els") for 0.4 s, t.half ("half the queue") for 0.4 s. / hold_frozen: Hold h2 (settle, 2.0 s after word 33) should show: "the login share stays lit as half of all tickets". Nothing on screen changes from 15.3 to 17.3 s: a frozen frame.
- **ball-drop**: competing: During e2 (6.4 to 10.7 s) the eye should be on "the two balls held at the top" (t.bowl_ball, t.tennis), but only 18% of the change on screen is there; 2 other things pull at it: ph ("?") for 1.2 s, q.1 ("Which lands first?") for 0.3 s. / hold_competing: During hold h1 (7.6 to 10.6 s, "both balls hang at the top; nothing moves toward the answer") the change is mostly away from the event's look (t.bowl_ball, t.tennis): ph ("?") for 0.5 s. / demo_rushed: Phase 1 of e3's demo (slow, 10.7 to 17.0 s) should go one step at a time, but the picture steps every 0.37 s (8 changes, the closest 
