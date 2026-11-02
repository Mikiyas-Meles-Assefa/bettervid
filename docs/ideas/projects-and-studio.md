# Projects, studio and speed: saved conversation

Saved Nov 2, 2026, at the user's request, for later. Not part of the current 13-subagent plan.

## The user's message, exact transcript

Image cut out and read. So what does take time? Like, let's say for 5 minutes video, can it take like 1 minute if that's the case, by parallelizing a lot? Like, what would the average be like? The reasonable average would be like, especially for demo. For demo, like I'm assuming like at max concurrent users could be like 3 or 4 judges. So if I have a cloud, if I am hosting it somewhere, well, what would it be the max speed that I could get for the demo? And also I want to ask about the upload, the understand the material library, the plan, script, voice and generator, right? Okay. Interesting. Blends with everything else. I see. Okay, I have a question regarding this one. Like, it could be like the PDF as a whole text and stuff like that. So the user intent matters. Yeah, now I'm questioning, like, there could be one generator box where they can upload stuff or image and text, and then they type their intent for what is going to be generated. And there could be a project as well, which is like notebook LM. But it could let them upload a lot of things, and then it's gonna be a project, and it's gonna be a blended stuff. It's gonna be parsed. It's gonna understand everything, not even the image, in like PDFs, image, text, videos, audios, and stuff like that. And then in the middle, like as if, since it's a project, it's a studio to generate videos. Like, they can choose the number of videos, the orientation, the landscape. Or portrait or stuff like that, the style, or create a style with a style box or stuff like that, and then like let them generate like educational, like stuff like that, you know. I don't know, it depends. And then like maybe even slides and stuff like that, and then make them generate, and then they can choose a number of videos or the type of they can chat with it to prepare the series. Like, let's say it could be a series of videos, like it could be a series of short videos, let's say like of 35 videos out of those whole project and stuff like that, which is a little, sometimes depends on their chat. It could be like or it could be like landscape videos, like 5 long landscape videos with auto links, not auto link, I don't know, basically kind of stuff like that, like designing a whole playlist, you know, like a project where they could design a whole playlist or create even one video or another playlist about some aspect of the project. Let's say from these old documents, like prepare playlist or like and this and this and this and stuff like that, you know. All these things are gonna be customizable, you know. I know that's gonna be a later issue, but that's gonna be the project mode, and then the basic mode is gonna be just to generate a single version. So that's what I'm thinking, and then the intent should be understood. But I'm debating whether if we need the video to be generated for each of them or not. I mean, if the normal generator needs a chat mode as well, like if the user intent is not clear, like it could ask for clarification and stuff like that, or it's gonna just be a box that to generate something like the current one that we have, or should we just only have the project mode and not this mode? I'm not sure. So can you save the exact transcript of what I said, and what you're gonna respond to me in some folder, I mean in some file for the future, and also let me know when do you think we can come back to these issues, like parsing documents and stuff like that or extracting and building the engine in a way that it handles it and stuff like that. Should it be like after we're done with the current plan of the whole plan, like the subagent plan of 13 subagent plan that we did, should we talk about it later after that? Should I remind you about that later, or should it be part of it now?

## The response

### Speed

These are estimates, based on the 5:40 Rosetta run on a Mac.

Time goes to these steps: research about 40 s, writing 1.5 to 3 minutes, voice about 1 minute, visual planning about 1 to 2 minutes, images a few minutes, and rendering about 10 minutes on 4 workers.

A full 5-minute video in 1 minute is not realistic. Rendering can get that fast with many machines, but research, writing, voice and planning run mostly in order, and each waits on model replies. Their total is 3 to 6 minutes.

Reasonable targets with good cloud hardware:

| Video | Time to finished video |
|---|---|
| 1 minute | 2 to 3 minutes |
| 5 minutes | 5 to 8 minutes |

For a demo with 3 or 4 judges at once:

- One strong machine of about 16 to 32 cores is enough. A burst render service is an option if needed. The real numbers need testing once hosted.
- Run a short video by default, around 60 seconds.
- Stream the work: show the plan and script as they appear.
- A live preview in the browser is the biggest gain, because the viewer can start watching before the final render is done.
- Gallery and replay remain instant.

### The whole text of a PDF, and intent

A PDF is not only a source of figures. All of its text is material too, and the user's intent decides how it is used.

### One box, projects, or both

Recommendation: have both, built on one system, with projects later.

- **Basic mode stays:** one box with attachments and intent. It is the fastest way in, and judges need it.
- **A single video is a project of one.** Underneath, both modes share the same material library, planner and engine, so nothing is built twice.
- **Clarifying:** the box should normally just generate. It should ask only when a wrong guess would waste the video, and at most one or two short questions.
- **Project mode, later:** a NotebookLM-like studio. Upload many things and it understands all of them. Chat to design the output: one video, a series of 35 shorts, or 5 long landscape videos. Choose number, orientation, style, or create a style. Slides could come from the same scenes.

Do not ship project mode only: it is too heavy for someone who wants one video.

### When to come back to this

Not part of the current 13-subagent plan. Finish the engine core first, because uploads need it.

1. **Now:** nothing to build. Keep the engine able to use cut-out images as parts, which it already can.
2. **After the 13:** build Your Material: upload, parsing, material library, cutting with SAM, reading with Spark, and the one-box intent step.
3. **After submission:** project mode, series and playlists, slides, orientation and landscape.

The user does not need to remember this: it is saved here, and listed in `docs/FIXES.md`.
