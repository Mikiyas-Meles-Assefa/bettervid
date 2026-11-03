#!/bin/zsh
# Contact sheet: N evenly spaced frames of a video, in one image. sheet.sh video out.png [n] [columns]
n=${3:-8}; c=${4:-4}
d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$1")
fps=$(python3 -c "print($n/$d)")
ffmpeg -v error -y -i "$1" -vf "fps=$fps,scale=300:-1,tile=${c}x$(( (n + c - 1) / c )):padding=6:color=gray" -frames:v 1 -update 1 "$2"
