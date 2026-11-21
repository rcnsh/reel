# Timed tokens are matched to the script by edit distance

Voices, aligners and transcribers return tokens in their own spelling: "3.5" may come back as "35", and punctuation is dropped. So `timeScript` and `alignWords` in `tools/align-words.ts` do not zip tokens to script words by position. They run an edit-distance alignment on normalised words (`normWord`). A script word that was not heard costs 1, a substitution 1.2, and an extra heard word only 0.5, because extra words are usually a retake or a filler. Each script word that matches takes its token's time. A run of unmatched words shares the time between its matched neighbours, by length; the passage's `start` and `end` bound the runs at either end.

## Considered options

Zipping tokens to words by index breaks on the first respelled figure or the first filler word, and every later word lands on the wrong speech.
