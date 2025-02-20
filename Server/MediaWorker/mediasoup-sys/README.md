# The Reason for This Folder

Many parts of this folder and the subfolders are lifted from mediasoup-sys of the Mediasoup project.
The reason for doing this is that their automatic build script for mediasoup that is used in
mediasoup-sys breaks every so often. To work around this, a patched mediasoup-sys is provided which just links against libmediasoup.a
letting the person doing the compiling figure out how to aquire that file. Doing that is not hard, simply 
create a virtual python environment, install 'invoke' using pip3. Then call `invoke libmediasoupworker` from the command line.
In some cases you might also have to patch tasks.py so that PTY is disabled (if you are using Wezterm on Windows for instance).
Anyway, mediasoup has graciously granted usage of their code under ISC license. 

# Original Copyright Notice for Mediasoup-sys

ISC License

Copyright © 2015, Iñaki Baz Castillo <ibc@aliax.net>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.