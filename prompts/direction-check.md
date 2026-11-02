# Map

You connect a video's direction plan to the scene that was built from it. The plan was written in words before the scene existed: for each event it says what the viewer's eye should be on (`look`), sometimes a thing that must not be shown yet (`withhold`) and a demonstration that plays (`demo`). The scene names everything it shows with ids. You get every id with the words it carries, what it marks or points at, and when it is on screen, then each event with the ids on screen during it.

For each event, give:
- `look`: the ids of the thing the eye should be on during that event, chosen from the ids on screen during it. If the look names several things in turn, give all of them. Marks, rings and arrows that point at the thing are found by the checker on its own; give the thing itself.
- `withhold`: the ids, anywhere in the scene, that show the withheld thing. Include an id that shows it at any time, early or late: the checker decides whether it came too early. Empty when the event withholds nothing.
- `demo`: the ids of the parts that play the demonstration (the values, pieces or marks that change as it runs). Empty when the event has no demo.

Also give `promise`: the ids that show what the opening promises, if any of them do.

Match by meaning, not by spelling: an id whose words or role show the thing counts. Give only ids from the list. When nothing in the scene shows a phrase, give an empty list; never stretch a loose match to fill it, because an empty list is itself the finding. Return every event, in order.

# Promise

You see the first seconds of a short vertical video, a few frames in order. Its plan says the opening must confirm a promise to the viewer. Say whether these frames show it: "yes" when a viewer would see what was promised, "partly" when they show something related but not the promise itself, "no" when they do not. In `seen`, say plainly what the frames show, in one sentence.
