Say what you want in ordinary words. For example: "Show me videos of wolves" or "Make a 12 second video from the selected clips."

You can also type a command exactly.

count_videos
Counts videos for a subject.
count_videos crows

show_videos
Shows videos for a subject.
show_videos wolves

make_video
Makes a video about a subject. Several pages of footage open, and four clips are chosen from them. The video is 15 seconds unless a length is named. A shot limit uses enough clips to fill that length, and no shot runs longer.
make_video children on the beach shot=2 seconds=30
make_video children on the beach
make_video children on the beach 10
After a video is on screen, name a maker to keep only that person's clips.
make_video maker="Kampus Production"

make_cut
Makes a video from the clips you have selected.
The length is whatever you ask for, up to 10 minutes. Every selected clip is used, up to 60.
make_cut 12

edit_cut
Opens the editor on the current video. A shot can be trimmed, moved, or removed from here too. Selected clips that are not already in the video can be added to the end.
edit_cut
edit_cut trim clip=2 edge=end by=-0.5
edit_cut move from=3 to=1
edit_cut remove clip=2
edit_cut add

project_settings
Opens the project settings: the property name, logo, where the logo sits, type, and theme.
project_settings

clear_history
Clears the conversation.
clear_history

commands
Shows this list.
commands
