module Stage exposing
    ( Chord(..)
    , StageState
    , acceptLines
    , activeFor
    , addRaisedHand
    , audienceLine
    , blank
    , chordFromName
    , declineLines
    , endLines
    , foldCtcp
    , foldNick
    , foldSelfLeave
    , handLines
    , inviteLine
    , recordInvite
    , isModerator
    , isSpeakerModes
    , joinLines
    , leaveLines
    , maxRaisedHands
    , normalizeChannel
    , normalizeNick
    , propOn
    , removeRaisedHand
    , speakingAnnouncement
    , startLines
    , statusLine
    )

{-| v3/calls-c11 — stage mode (`CALLS_DESIGN.md` §2.16), a pure port of
the oracle store's stage slice (`store.ts` `joinStage` … `removeRaisedHand`
and the inbound `CTCP STAGE` arm) plus the C12 call chord table.

A stage is a room state layered on the voice stage: the host turns it
on with `MODE +m` + `PROP <room> STAGE 1`; the audience raises hands
over channel-scoped CTCP (`STAGE RAISE_HAND` / `LOWER_HAND`); the host
invites (`STAGE INVITE_SPEAK <nick>`), the invitee answers
(`ACCEPT_SPEAK` / `DECLINE_SPEAK`) and the host voices them
(`MODE +v`). Onyx Server has no dedicated stage verb: everything here is
CTCP between clients plus ordinary MODE/PROP, so the UI never claims
more authority than those carry.

Everything is DOM-free; `App` owns the model field and the wiring.

-}

import Set exposing (Set)
import Wire


maxRaisedHands : Int
maxRaisedHands =
    128


maxNickLength : Int
maxNickLength =
    64


maxChannelLength : Int
maxChannelLength =
    512


type alias StageState =
    { channel : Maybe String
    , raisedHands : List String
    , isHost : Bool
    , isSpeaker : Bool
    , handRaised : Bool
    , pendingInvite : Maybe String
    , invited : List String
    }


blank : StageState
blank =
    { channel = Nothing
    , raisedHands = []
    , isHost = False
    , isSpeaker = False
    , handRaised = False
    , pendingInvite = Nothing
    , invited = []
    }


validToken : Int -> String -> Bool
validToken limit value =
    not (String.isEmpty value)
        && (String.length value <= limit)
        && not (String.any (\c -> c == ' ' || Char.toCode c < 32 || Char.toCode c == 127) value)


{-| Oracle `_normalizeStageNick`: a single wire token, no leading `:`,
no `,`.
-}
normalizeNick : String -> Maybe String
normalizeNick value =
    if validToken maxNickLength value && not (String.startsWith ":" value) && not (String.contains "," value) then
        Just value

    else
        Nothing


{-| Oracle `_normalizeStageChannel`: trimmed, `#`/`&` prefixed, one
wire token, no `,`.
-}
normalizeChannel : String -> Maybe String
normalizeChannel value =
    let
        channel =
            String.trim value
    in
    if
        validToken maxChannelLength channel
            && (String.startsWith "#" channel || String.startsWith "&" channel)
            && not (String.contains "," channel)
    then
        Just channel

    else
        Nothing


sameKey : String -> String -> Bool
sameKey a b =
    String.toLower a == String.toLower b


{-| This client holds stage state for the room (oracle `activeHere`). -}
activeFor : StageState -> String -> Bool
activeFor stage room =
    case stage.channel of
        Just ch ->
            sameKey ch room

        Nothing ->
            False


{-| `PROP STAGE` reads on (`1` / `true` / `on`). -}
propOn : Maybe String -> Bool
propOn raw =
    case raw of
        Just v ->
            List.member v [ "1", "true", "on" ]

        Nothing ->
            False


{-| Oracle moderator test for `INVITE_SPEAK`: Y Q q a o. -}
isModerator : Set Char -> Bool
isModerator modes =
    List.any (\m -> Set.member m modes) [ 'Y', 'Q', 'q', 'a', 'o' ]


{-| A stage speaker holds voice or better in the room (`+v` is what
the host grants on accept).
-}
isSpeakerModes : Set Char -> Bool
isSpeakerModes modes =
    List.any (\m -> Set.member m modes) [ 'Y', 'Q', 'q', 'a', 'o', 'h', 'v' ]


addRaisedHand : String -> StageState -> StageState
addRaisedHand nick stage =
    case normalizeNick nick of
        Nothing ->
            stage

        Just safe ->
            let
                existing =
                    List.any (sameKey safe) stage.raisedHands
            in
            if not existing && List.length stage.raisedHands >= maxRaisedHands then
                stage

            else
                { stage | raisedHands = List.filter (not << sameKey safe) stage.raisedHands ++ [ safe ] }


removeRaisedHand : String -> StageState -> StageState
removeRaisedHand nick stage =
    case normalizeNick nick of
        Nothing ->
            stage

        Just safe ->
            { stage
                | raisedHands = List.filter (not << sameKey safe) stage.raisedHands
                , invited = List.filter (not << sameKey safe) stage.invited
            }


{-| Host side: remember that WE invited `nick` to speak, so only an
`ACCEPT_SPEAK` answering our own invite can earn `MODE +v` (a raised
hand alone is attacker-controlled). Capped like the hand queue.
-}
recordInvite : String -> StageState -> StageState
recordInvite nick stage =
    case normalizeNick nick of
        Nothing ->
            stage

        Just safe ->
            if not stage.isHost || List.any (sameKey safe) stage.invited then
                stage

            else if List.length stage.invited >= maxRaisedHands then
                stage

            else
                { stage | invited = stage.invited ++ [ safe ] }


ctcp : String -> String -> String
ctcp channel body =
    Wire.formatIrcLine "PRIVMSG" [ channel, "\u{0001}STAGE " ++ body ++ "\u{0001}" ]


{-| `joinStage`: JOIN only when not already a member, then a fresh
audience state. `Nothing` when the room name is unusable.
-}
joinLines : { member : Bool } -> String -> Maybe ( StageState, List String )
joinLines { member } room =
    normalizeChannel room
        |> Maybe.map
            (\target ->
                ( { blank | channel = Just target }
                , if member then
                    []

                  else
                    [ Wire.formatIrcLine "JOIN" [ target ] ]
                )
            )


{-| `startStage`: `MODE +m` then `PROP STAGE 1`; host and speaker. -}
startLines : String -> Maybe ( StageState, List String )
startLines room =
    normalizeChannel room
        |> Maybe.map
            (\target ->
                ( { blank | channel = Just target, isHost = True, isSpeaker = True }
                , [ Wire.formatIrcLine "MODE" [ target, "+m" ], Wire.formatIrcLine "PROP" [ target, "STAGE", "1" ] ]
                )
            )


{-| `endStage`: `MODE -m` + `PROP STAGE 0`, then a clean slate. -}
endLines : StageState -> ( StageState, List String )
endLines stage =
    ( blank
    , case stage.channel of
        Just ch ->
            [ Wire.formatIrcLine "MODE" [ ch, "-m" ], Wire.formatIrcLine "PROP" [ ch, "STAGE", "0" ] ]

        Nothing ->
            []
    )


{-| `leaveStage`: PART with "Left stage", then a clean slate. -}
leaveLines : StageState -> ( StageState, List String )
leaveLines stage =
    ( blank
    , case stage.channel of
        Just ch ->
            [ Wire.formatIrcLine "PART" [ ch, "Left stage" ] ]

        Nothing ->
            []
    )


{-| Raise (`True`) or lower the own hand. -}
handLines : Bool -> StageState -> ( StageState, List String )
handLines raise stage =
    case stage.channel of
        Just ch ->
            ( { stage | handRaised = raise }
            , [ ctcp ch
                    (if raise then
                        "RAISE_HAND"

                     else
                        "LOWER_HAND"
                    )
              ]
            )

        Nothing ->
            ( stage, [] )


inviteLine : String -> StageState -> List String
inviteLine nick stage =
    case ( stage.channel, normalizeNick nick ) of
        ( Just ch, Just target ) ->
            [ ctcp ch ("INVITE_SPEAK " ++ target) ]

        _ ->
            []


acceptLines : StageState -> ( StageState, List String )
acceptLines stage =
    case stage.channel of
        Just ch ->
            ( { stage | isSpeaker = True, pendingInvite = Nothing, handRaised = False }, [ ctcp ch "ACCEPT_SPEAK" ] )

        Nothing ->
            ( stage, [] )


declineLines : StageState -> ( StageState, List String )
declineLines stage =
    ( { stage | pendingInvite = Nothing }
    , case stage.channel of
        Just ch ->
            [ ctcp ch "DECLINE_SPEAK" ]

        Nothing ->
            []
    )


{-| Inbound `\x01STAGE …\x01` on a channel. `Nothing` when the body is
not a STAGE wrapper; otherwise the next state, the CRLF-framed lines to send (the
host's `MODE +v` on an accepted invite) and whether a new hand went up
(for the announcer). Mirrors the oracle gates: never self, only the
exact active stage room, only from a current member; `INVITE_SPEAK`
only from a moderator and only addressed to us; `ACCEPT_SPEAK` voices
only someone whose hand was in the queue, and only when we host.
-}
foldCtcp :
    { ourNick : String
    , sender : String
    , target : String
    , body : String
    , memberModes : String -> Maybe (Set Char)
    }
    -> StageState
    -> Maybe { stage : StageState, lines : List String, raised : Maybe String }
foldCtcp input stage =
    if not (String.startsWith "\u{0001}STAGE " input.body && String.endsWith "\u{0001}" input.body && String.length input.body > 8) then
        Nothing

    else if sameKey input.sender input.ourNick then
        Nothing

    else
        let
            inner =
                String.slice 7 -1 input.body

            parts =
                String.words inner

            cmd =
                List.head parts |> Maybe.withDefault ""

            arg =
                List.drop 1 parts |> List.head |> Maybe.withDefault ""

            unchanged =
                Just { stage = stage, lines = [], raised = Nothing }
        in
        case ( normalizeNick input.sender, stage.channel ) of
            ( Just sender, Just room ) ->
                if not (sameKey input.target room) then
                    unchanged

                else
                    case input.memberModes sender of
                        Nothing ->
                            unchanged

                        Just modes ->
                            case cmd of
                                "RAISE_HAND" ->
                                    let
                                        next =
                                            addRaisedHand sender stage

                                        isNew =
                                            not (List.any (sameKey sender) stage.raisedHands)
                                                && List.any (sameKey sender) next.raisedHands
                                    in
                                    Just
                                        { stage = next
                                        , lines = []
                                        , raised =
                                            if isNew then
                                                Just sender

                                            else
                                                Nothing
                                        }

                                "LOWER_HAND" ->
                                    Just { stage = removeRaisedHand sender stage, lines = [], raised = Nothing }

                                "INVITE_SPEAK" ->
                                    if isModerator modes && sameKey arg input.ourNick then
                                        Just { stage = { stage | pendingInvite = Just sender }, lines = [], raised = Nothing }

                                    else
                                        unchanged

                                "ACCEPT_SPEAK" ->
                                    let
                                        -- Only an answer to an invite WE sent earns
                                        -- voice: the hand queue is peer-controlled
                                        -- (RAISE_HAND has no authority check), so a
                                        -- raised hand alone must never voice anyone.
                                        wasInvited =
                                            List.any (sameKey sender) stage.invited
                                    in
                                    Just
                                        { stage = removeRaisedHand sender stage
                                        , lines =
                                            if stage.isHost && wasInvited then
                                                [ Wire.formatIrcLine "MODE" [ room, "+v", sender ] ]

                                            else
                                                []
                                        , raised = Nothing
                                        }

                                "DECLINE_SPEAK" ->
                                    Just { stage = removeRaisedHand sender stage, lines = [], raised = Nothing }

                                _ ->
                                    unchanged

            _ ->
                unchanged


{-| A NICK change carries queue rows and a pending invite across. -}
foldNick : String -> String -> StageState -> StageState
foldNick old new stage =
    case normalizeNick new of
        Nothing ->
            stage

        Just safe ->
            let
                swap n =
                    if sameKey n old then
                        safe

                    else
                        n
            in
            { stage
                | raisedHands = List.map swap stage.raisedHands
                , pendingInvite = Maybe.map swap stage.pendingInvite
                , invited = List.map swap stage.invited
            }


{-| Our own PART (or KICK) from the stage room clears all stage
authority and transient rows.
-}
foldSelfLeave : String -> StageState -> StageState
foldSelfLeave room stage =
    if activeFor stage room then
        blank

    else
        stage



-- VIEW COPY


{-| "Stage is live · You are a speaker" / "… · You are in the audience". -}
statusLine : Bool -> String
statusLine speaker =
    "Stage is live · "
        ++ (if speaker then
                "You are a speaker"

            else
                "You are in the audience"
           )


plural : Int -> String -> String -> String
plural n one many =
    String.fromInt n
        ++ " "
        ++ (if n == 1 then
                one

            else
                many
           )


{-| "Audience · N listening · M raised hands". -}
audienceLine : Int -> Int -> String
audienceLine listening hands =
    "Audience · " ++ String.fromInt listening ++ " listening · " ++ plural hands "raised hand" "raised hands"


{-| On-demand "who is speaking" (spec §3.3, Ctrl+Shift+S). -}
speakingAnnouncement : List String -> String
speakingAnnouncement names =
    case names of
        [] ->
            "No one is speaking"

        [ one ] ->
            one ++ " is speaking"

        [ a, b ] ->
            a ++ " and " ++ b ++ " are speaking"

        _ ->
            String.fromInt (List.length names) ++ " people are speaking"



-- C12 CALL CHORDS


{-| Modifier chords delivered by `ports.js` as `call-<name>`. -}
type Chord
    = ChordMute
    | ChordCamera
    | ChordHand
    | ChordLeave
    | ChordLayout
    | ChordSize
    | ChordSpeaker
    -- v3/calls-c8
    | ChordCaptions


chordFromName : String -> Maybe Chord
chordFromName name =
    case name of
        "mute" ->
            Just ChordMute

        -- v3/calls-c8
        "captions" ->
            Just ChordCaptions

        "camera" ->
            Just ChordCamera

        "hand" ->
            Just ChordHand

        "leave" ->
            Just ChordLeave

        "layout" ->
            Just ChordLayout

        "size" ->
            Just ChordSize

        "speaker" ->
            Just ChordSpeaker

        _ ->
            Nothing
