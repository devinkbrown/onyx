module CallCaptions exposing
    ( CaptionLine
    , Chip
    , CopyState(..)
    , Overlay
    , blankOverlay
    , captionKey
    , captionLines
    , captionSource
    , captionTranslationId
    , chipVerb
    , composite
    , contrastRatio
    , copyResultText
    , copyTag
    , handHoldMs
    , handLabel
    , isHandEmoji
    , lineOpacity
    , maxChips
    , parseHex
    , quickReactions
    , reactionAria
    , reactionLifetimeMs
    , recordLocalReaction
    , rovingIndex
    , selfHand
    , settle
    , transcriptLine
    , transcriptText
    , visibleChips
    )

{-| v3/calls-c8 — calls slice C8: live captions overlay + reactions
overlay (`elm/design/calls/CALLS_DESIGN.md` §2.10, §3.3, §3.4).

Pure, DOM-free logic over the state the core already folds:

  - captions read `media.transcripts` (the MEDIA CAPTION/TRANSCRIPT
    fold in `Media`) for the call's channel — last 3 lines, the
    oracle's `CaptionsOverlay` copy and transcript format;
  - reactions read `media.reactions` (the MEDIA REACT fold). The fold
    is clock-free, so `settle` stamps each newly folded reaction with
    the shell clock and keeps a short chip list that expires after
    2600ms (oracle `reactionLifetimeMs`), at most 3 stacked;
  - a ✋ reaction from a peer raises their hand for 15s (oracle
    `useCadenceMedia` `onReaction` hand timer — there is no explicit
    lower signal);
  - a WCAG contrast helper pins the caption plate's ≥ 4.5:1 rule on
    the token values (spec §2.10 acceptance).

Extensible records only, so `App` calls in without an import cycle.

-}

import Dict exposing (Dict)
import Media exposing (CallLifecycle(..), MediaReaction, MediaState, TranscriptEntry)
import Set



-- STATE


type CopyState
    = CopyIdle
    | CopyBusy
    | CopyDone
    | CopyBlocked


{-| One reaction chip: the lowercased roster key, the validated
emoji, the shell-clock stamp and a sequence id for keyed rendering.
-}
type alias Chip =
    { id : Int
    , key : String
    , emoji : String
    , at : Float
    }


{-| Call-overlay state (one Model field). `captionsOn` mirrors the
oracle's `voice.captionsEnabled` (default off); `handRaised` the
local `voice.handRaised`; `reactOpen` / `reactIndex` the React menu
and its roving tab stop; `handExpiry` the 15s auto-clear for peer
hands raised via ✋.
-}
type alias Overlay =
    { captionsOn : Bool
    , handRaised : Bool
    , reactOpen : Bool
    , reactIndex : Int
    , chips : List Chip
    , chipSeq : Int
    , handExpiry : Dict String Float
    , copy : CopyState
    }


blankOverlay : Overlay
blankOverlay =
    { captionsOn = False
    , handRaised = False
    , reactOpen = False
    , reactIndex = 0
    , chips = []
    , chipSeq = 0
    , handExpiry = Dict.empty
    , copy = CopyIdle
    }



-- REACTIONS


{-| Oracle `QUICK_REACTIONS` (VoiceBar.tsx), in menu order. -}
quickReactions : List String
quickReactions =
    [ "👍", "❤️", "😂", "🎉", "👏", "🔥", "😮", "✋" ]


{-| Oracle `reactionLifetimeMs`. -}
reactionLifetimeMs : Float
reactionLifetimeMs =
    2600


{-| Spec §2.10: at most 3 chips stacked. -}
maxChips : Int
maxChips =
    3


{-| Peer hand raised via ✋ auto-clears after 15s (oracle). -}
handHoldMs : Float
handHoldMs =
    15000


isHandEmoji : String -> Bool
isHandEmoji emoji =
    String.trim emoji == "✋"


{-| The verb after the glyph: ✋ reads "raised a hand"; every other
reaction is the glyph alone.
-}
chipVerb : String -> Maybe String
chipVerb emoji =
    if isHandEmoji emoji then
        Just "raised a hand"

    else
        Nothing


{-| Menu item aria (oracle `React with {emoji}`). -}
reactionAria : String -> String
reactionAria emoji =
    "React with " ++ emoji


handLabel : Bool -> String
handLabel raised =
    if raised then
        "Lower hand"

    else
        "Raise hand"


{-| Roving focus inside the React menu (oracle
`handleReactionKeyDown`): Right/Down next, Left/Up previous (both
wrap), Home first, End last; any other key is not ours.
-}
rovingIndex : String -> Int -> Int -> Maybe Int
rovingIndex key index count =
    if count <= 0 then
        Nothing

    else
        let
            wrap n =
                modBy count n
        in
        case key of
            "ArrowRight" ->
                Just (wrap (index + 1))

            "ArrowDown" ->
                Just (wrap (index + 1))

            "ArrowLeft" ->
                Just (wrap (index - 1))

            "ArrowUp" ->
                Just (wrap (index - 1))

            "Home" ->
                Just 0

            "End" ->
                Just (count - 1)

            _ ->
                Nothing


{-| Unexpired chips at `now`, newest last, at most `maxChips`. -}
visibleChips : Float -> List Chip -> List Chip
visibleChips now chips =
    chips
        |> List.filter (\c -> now - c.at < reactionLifetimeMs)
        |> takeLast maxChips


takeLast : Int -> List a -> List a
takeLast n list =
    List.drop (max 0 (List.length list - n)) list


addChip : Float -> String -> String -> Overlay -> Overlay
addChip now key emoji overlay =
    { overlay
        | chips = takeLast maxChips (visibleChips now overlay.chips ++ [ { id = overlay.chipSeq, key = key, emoji = emoji, at = now } ])
        , chipSeq = overlay.chipSeq + 1
    }


{-| The local echo of a reaction we sent (oracle `sendCallReaction`
dispatches its own `onyx:voice-reaction` so the sender sees it at
once).
-}
recordLocalReaction : Float -> String -> String -> Overlay -> Overlay
recordLocalReaction now selfKey emoji overlay =
    addChip now (String.toLower selfKey) emoji overlay


{-| Our own hand in the shared `hands` set (the stage and tiles read
it), raised or lowered with the local toggle.
-}
selfHand : Bool -> String -> MediaState -> MediaState
selfHand raised nick media =
    let
        key =
            String.toLower (String.trim nick)
    in
    if String.isEmpty key then
        media

    else if raised then
        { media | hands = Set.insert key media.hands }

    else
        { media | hands = Set.remove key media.hands }



-- CAPTIONS


type alias CaptionLine =
    { nick : String
    , text : String
    , time : Maybe String
    , key : String
    }


{-| Content-stable caption key (oracle `captionKey`: lines scroll, so
an index is not stable).
-}
captionKey : TranscriptEntry -> String
captionKey entry =
    Maybe.withDefault "" entry.time ++ "|" ++ entry.nick ++ "|" ++ entry.text


{-| The translation id a caption line uses in the shared on-device
translation map (namespaced so it never collides with a msgid).
-}
captionTranslationId : String -> String
captionTranslationId key =
    "caption:" ++ key


{-| The last 3 caption lines for the live call (oracle: the call
channel, else the viewed channel; nothing while idle or when captions
are off).
-}
captionLines : { captionsOn : Bool, lifecycle : CallLifecycle, channel : Maybe String, activeChannel : Maybe String } -> MediaState -> List CaptionLine
captionLines input media =
    let
        target =
            case input.channel of
                Just c ->
                    Just c

                Nothing ->
                    input.activeChannel
    in
    if not input.captionsOn || input.lifecycle == Idle then
        []

    else
        case target of
            Just t ->
                Dict.get (String.toLower t) media.transcripts
                    |> Maybe.withDefault []
                    |> takeLast 3
                    |> List.map (\e -> { nick = e.nick, text = e.text, time = e.time, key = captionKey e })

            Nothing ->
                []


{-| Older lines read at 75% (spec §2.10); the newest is full. The
view applies it to the caption TEXT colour only — a 75% speaker name
in `--onyx-dim` would fall to ~4.3:1 on the plate (contrast vectors).
-}
lineOpacity : Int -> Int -> Float
lineOpacity index count =
    if index == count - 1 then
        1

    else
        0.75


captionSource : Bool -> String
captionSource live =
    if live then
        "Live from this call"

    else
        "Captions unavailable while reconnecting"


copyTag : String
copyTag =
    "call-captions"


copyResultText : CopyState -> Maybe String
copyResultText state =
    case state of
        CopyDone ->
            Just "Copied"

        CopyBlocked ->
            Just "Clipboard unavailable"

        _ ->
            Nothing


{-| Oracle `transcriptLine`: "[HH:MM] nick: text". The clock comes
from the server `time` tag (UTC, `HH:MM` of the ISO stamp); a line
without one drops the bracket rather than inventing a time.
-}
transcriptLine : { a | nick : String, text : String, time : Maybe String } -> String
transcriptLine line =
    let
        clock =
            line.time
                |> Maybe.map (String.slice 11 16)
                |> Maybe.andThen
                    (\hhmm ->
                        if String.length hhmm == 5 && String.slice 2 3 hhmm == ":" then
                            Just ("[" ++ hhmm ++ "] ")

                        else
                            Nothing
                    )
                |> Maybe.withDefault ""
    in
    clock ++ line.nick ++ ": " ++ line.text


{-| The whole buffered transcript for the call channel (not just the
3 visible lines — oracle `transcriptText` joins every line).
-}
transcriptText : Maybe String -> MediaState -> String
transcriptText channel media =
    case channel of
        Just c ->
            Dict.get (String.toLower c) media.transcripts
                |> Maybe.withDefault []
                |> List.map transcriptLine
                |> String.join "\n"

        Nothing ->
            ""



-- CONTRAST (spec §2.10: ≥ 4.5:1 on the token values)


{-| `#rrggbb` → (r, g, b) in 0–255. -}
parseHex : String -> Maybe ( Float, Float, Float )
parseHex raw =
    let
        trimmed =
            String.toLower (String.trim raw)

        hex =
            if String.startsWith "#" trimmed then
                String.dropLeft 1 trimmed

            else
                trimmed

        digit c =
            String.indexes (String.fromChar c) "0123456789abcdef" |> List.head

        byte s =
            case String.toList s of
                [ a, b ] ->
                    Maybe.map2 (\x y -> toFloat (x * 16 + y)) (digit a) (digit b)

                _ ->
                    Nothing
    in
    if String.length hex /= 6 then
        Nothing

    else
        Maybe.map3 (\r g b -> ( r, g, b ))
            (byte (String.slice 0 2 hex))
            (byte (String.slice 2 4 hex))
            (byte (String.slice 4 6 hex))


{-| `alpha` of `top` over `bottom` (straight alpha compositing). -}
composite : Float -> ( Float, Float, Float ) -> ( Float, Float, Float ) -> ( Float, Float, Float )
composite alpha ( r1, g1, b1 ) ( r2, g2, b2 ) =
    ( alpha * r1 + (1 - alpha) * r2
    , alpha * g1 + (1 - alpha) * g2
    , alpha * b1 + (1 - alpha) * b2
    )


luminance : ( Float, Float, Float ) -> Float
luminance ( r, g, b ) =
    let
        chan v =
            let
                s =
                    v / 255
            in
            if s <= 0.03928 then
                s / 12.92

            else
                ((s + 0.055) / 1.055) ^ 2.4
    in
    0.2126 * chan r + 0.7152 * chan g + 0.0722 * chan b


{-| WCAG 2.x contrast ratio. -}
contrastRatio : ( Float, Float, Float ) -> ( Float, Float, Float ) -> Float
contrastRatio a b =
    let
        la =
            luminance a

        lb =
            luminance b
    in
    (max la lb + 0.05) / (min la lb + 0.05)



-- SETTLE


{-| Post-update fold, run once per `App.update`:

  - a call that went idle drops every overlay flag (captions, hand,
    menu, chips) and the hands it raised — the next call starts clean;
  - a reaction newly folded into `media.reactions` for the call's
    channel becomes a chip stamped with the shell clock (our own echo
    from the server is skipped while the local echo still shows);
  - a peer ✋ raises their hand for 15s; expired ones clear;
  - expired chips drop.

Narrowing: the fold keeps a capped list with no sequence numbers, so
a reaction identical to the one it evicts at the 32-entry cap (same
nick, same emoji, 33 in a row) is not seen as new.

-}
settle :
    { a | calls : Media.CallHub, media : MediaState }
    -> { b | calls : Media.CallHub, media : MediaState, callOverlay : Overlay, nowMs : Float, callClockMs : Float, ourNick : String }
    -> { b | calls : Media.CallHub, media : MediaState, callOverlay : Overlay, nowMs : Float, callClockMs : Float, ourNick : String }
settle before after =
    let
        now =
            max after.nowMs after.callClockMs

        overlay0 =
            after.callOverlay
    in
    if after.calls.lifecycle == Idle then
        if overlay0 == blankOverlay then
            after

        else
            { after
                | callOverlay = blankOverlay
                , media =
                    clearHands (Dict.keys overlay0.handExpiry)
                        (if overlay0.handRaised then
                            selfHand False after.ourNick after.media

                         else
                            after.media
                        )
            }

    else
        let
            selfKey =
                String.toLower after.ourNick

            callKey =
                Maybe.map String.toLower after.calls.channel

            fresh : Maybe MediaReaction
            fresh =
                if after.media.reactions == before.media.reactions then
                    Nothing

                else
                    List.head (List.reverse after.media.reactions)
                        |> Maybe.andThen
                            (\r ->
                                if Just r.channel == callKey then
                                    Just r

                                else
                                    Nothing
                            )

            ( overlay1, media1 ) =
                case fresh of
                    Just r ->
                        if r.nick == selfKey then
                            if List.any (\c -> c.key == selfKey && c.emoji == r.emoji) (visibleChips now overlay0.chips) then
                                ( overlay0, after.media )

                            else
                                ( addChip now r.nick r.emoji overlay0, after.media )

                        else if isHandEmoji r.emoji then
                            let
                                m =
                                    after.media
                            in
                            ( addChip now r.nick r.emoji { overlay0 | handExpiry = Dict.insert r.nick (now + handHoldMs) overlay0.handExpiry }
                            , { m | hands = Set.insert r.nick m.hands }
                            )

                        else
                            ( addChip now r.nick r.emoji overlay0, after.media )

                    Nothing ->
                        ( overlay0, after.media )

            ( expired, live ) =
                Dict.partition (\_ until -> now >= until) overlay1.handExpiry

            overlay2 =
                { overlay1 | handExpiry = live, chips = visibleChips now overlay1.chips }

            media2 =
                clearHands (Dict.keys expired) media1
        in
        if overlay2 == overlay0 && media2 == after.media then
            after

        else
            { after | callOverlay = overlay2, media = media2 }


clearHands : List String -> MediaState -> MediaState
clearHands keys media =
    if List.isEmpty keys then
        media

    else
        { media | hands = List.foldl Set.remove media.hands keys }
