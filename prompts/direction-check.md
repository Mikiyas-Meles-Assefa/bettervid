# Map

You connect a video's direction plan to the scene that was built from it. The plan was written in words before the scene existed: for each event it says what the viewer's eye should be on (`look`), sometimes a thing that must not be shown yet (`withhold`) and a demonstration that plays (`demo`). The scene names everything it shows with ids. You get every id with the words it carries, what it marks or points at, and when it is on screen, then each event with the ids on screen during it.

For each event, give:
- `look`: the ids of the thing the eye should be on during that event, chosen from the ids on screen during it. If the look names several things in turn, give all of them. Marks, rings and arrows that point at the thing are found by the checker on its own; give the thing itself.
- `lookNone`: empty when `look` has ids. When none of the things on screen during the event shows the look, leave `look` empty and say here, in one sentence, what is on screen instead. An empty `look` with an empty `lookNone` is read as no answer and asked again.
- `withhold`: where the scene shows the withheld thing, anywhere and at any time, early or late: the checker decides whether it came too early. Give each place as one set of ids that together show the thing whole (the parts of one finished result, one picture, one line); the thing counts as shown only when a whole set is on screen at once. Leave out parts that earlier events are meant to show on the way there, when they do not show the thing whole. Empty when the event withholds nothing.
- `demo`: the ids of the parts that play the demonstration (the values, pieces or marks that change as it runs). Empty when the event has no demo.
- `holds`: one entry per hold listed under the event. `does`: the ids its picture is about (what it says should move, light, dim, return or stay). For a predict hold, `answer` is the answer the viewer is asked to predict, as it would be written on screen, as short as it can be (a value, a word, a short phrase), and `ids` are the things, anywhere in the scene, that show that answer at any time as the answer to this question; leave out the same value appearing elsewhere for another reason. The checker decides whether it showed during the hold. For other holds, `answer` is empty and `ids` is empty.

Also give `promise`: the ids that show what the opening promises, if any of them do.

Things are listed with every text they show; "reads" gives the order when a thing's words change while it is on screen. A thing whose id is a code name is known by its words and by when it shows. Match by meaning, not by spelling: an id whose words or role show the thing counts. Give only ids from the list. Never stretch a loose match to fill a list: an empty list with its reason is itself the finding. Return every event, in order.

# Promise

You see the first seconds of a short vertical video, a few frames in order. Its plan says the opening must confirm a promise to the viewer. Say whether these frames show it: "yes" when a viewer would see what was promised, "partly" when they show something related but not the promise itself, "no" when they do not. In `seen`, say plainly what the frames show, in one sentence.
