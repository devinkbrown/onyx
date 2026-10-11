module AuthGate exposing
    ( Challenge(..)
    , ChallengeNotice(..)
    , ChallengeStop(..)
    , Ctx
    , Effect(..)
    , Flow(..)
    , Msg(..)
    , PasskeyPhase(..)
    , ResetPhase(..)
    , SetPass(..)
    , State
    , TwoFactorPhase(..)
    , blank
    , challengeAnswerLine
    , flowAccount
    , guestNick
    , identifiedAccount
    , identifyFailCopy
    , isResetRequestNotice
    , isTwoFactorRefusal
    , maxAnswerBytes
    , maxQuestionChars
    , noticeStandardReply
    , normalizeResetCode
    , normalizeTotpCode
    , onChallengeNotice
    , onClosed
    , onIdentified
    , onIdentifyFailed
    , onPowSolved
    , onRegistered
    , onResetFail
    , onResetRequested
    , onResetSuccess
    , onTwoFactorRefused
    , panelFocus
    , parseChallengeNotice
    , passkeyStatusCopy
    , resetConfirmLine
    , resetFailCopy
    , resetRequestLine
    , setPassFailCopy
    , setPassNotice
    , takesOver
    , update
    , utf8Bytes
    , validateNewPassword
    , wireToken
    )

{-| v3/gap-auth — the sign-in paths the connect gate was missing, as a
pure state machine (`App` interprets the `Effect`s, the views read
`State`). Every wire shape below is the Onyx Server's, read from its
source (`/home/kain/onyx-server`, version 0.7.0):

  - **Two-step sign-in.** With TOTP active the server refuses a
    knowledge-factor SASL success (`dispatch.zig`: 904 :Two-factor
    authentication required: log in with IDENTIFY <account> <password>
    <code>) and advertises `onyx/2fa=IDENTIFY`. The code path it
    supports is a plain connection plus `IDENTIFY <account> <password>
    <code>` (`server.zig handleIdentify`). The password never enters
    this state: it stays in the ports-side SASL credential slot and the
    ports compose the IDENTIFY line (`IdentifyHeld`).
  - **Pre-001 CHALLENGE** (`server.zig noticeChallenge`,
    `challenge.zig`). `NOTICE <nick> :CHALLENGE pow <hex-seed>` is
    solved ports-side (BLAKE3(seed ‖ answer)[0] == 0) and answered
    `CHALLENGE <answer>`; `CHALLENGE question <text>` asks the person;
    `CHALLENGE failed` / `wait` / `not required` settle it.
  - **Forgot password.** `RESETPASS <account>` (a generic NOTICE whether
    or not the account exists) then `RESETPASS <account> <code>
    <new-password>` → `:<srv> RESETPASS SUCCESS <account> :…` or
    `FAIL RESETPASS BAD_CODE|EXPIRED|NO_REQUEST|TOO_MANY_ATTEMPTS|
    UNAVAILABLE|INVALID_PASSWORD|TEMPORARILY_UNAVAILABLE`.
  - **Passkey sign-in.** `WEBAUTHN AUTH <account>` on a registered
    connection; the existing `Passkey` fold runs the ceremony and the
    server confirms with `NOTICE … :You are now identified as <acct>`.
  - **Change password** (`SETPASS <current> <new>`): the reply copy
    lives here; `App` owns the send.

RESETPASS, IDENTIFY and WEBAUTHN AUTH all need a registered
connection, and a registered account name cannot be used as a guest
nick (`server.zig registeredNickRequiresAuthentication`: 432 + close),
so the gate dials a plain `Guest#####` connection for them (`Dial`).

-}

import Wire



-- STATE


type alias State =
    { challenge : Challenge
    , flow : Flow
    , code : String
    , answer : String
    , resetAccount : String
    , resetCode : String
    , resetPassword : String
    , resetConfirm : String
    , error : Maybe String
    , setPass : SetPass
    , parkedJoin : Maybe String
    }


{-| The pre-001 challenge on the current connection. -}
type Challenge
    = NoChallenge
    | PowSolving String
    | PowSent
    | QuestionAsked { question : String, error : Maybe String, sent : Bool }
    | ChallengeStopped ChallengeStop


type ChallengeStop
    = StopPowRejected
    | StopTimedOut


type Flow
    = NoFlow
    | TwoFactor String TwoFactorPhase
    | PasskeySignIn String PasskeyPhase
    | Reset ResetPhase


type TwoFactorPhase
    = TfaCode
    | TfaDialing
    | TfaVerifying


type PasskeyPhase
    = PkDialing
    | PkWaiting
    | PkStopped


type ResetPhase
    = ResetAsk
    | ResetAsking
    | ResetEnter
    | ResetSetting
    | ResetDone


{-| A `SETPASS` sent from the Account panel (the account it was sent
for), and its settled outcome.
-}
type SetPass
    = SetPassIdle
    | SetPassPending String
    | SetPassDone


blank : State
blank =
    { challenge = NoChallenge
    , flow = NoFlow
    , code = ""
    , answer = ""
    , resetAccount = ""
    , resetCode = ""
    , resetPassword = ""
    , resetConfirm = ""
    , error = Nothing
    , setPass = SetPassIdle
    , parkedJoin = Nothing
    }


{-| `live`: registered (001 seen); `socketOpen`: any socket up or
dialing; `signInNick`: the connect form's name field. -}
type alias Ctx =
    { live : Bool
    , socketOpen : Bool
    , signInNick : String
    }


type Msg
    = CodeInput String
    | CodeSubmit
    | UseRecoveryCode
    | AnswerInput String
    | AnswerSubmit
    | ChallengeRetry
    | ChallengeDismiss
    | PasskeyStart
    | PasskeyRetry
    | ResetOpen
    | ResetAccountInput String
    | ResetRequestSubmit
    | ResetHaveCode
    | ResetCodeInput String
    | ResetPasswordInput String
    | ResetConfirmInput String
    | ResetConfirmSubmit
    | ResetAgain
    | DoneSignIn
    | Cancel


{-| What `App` must do. `Dial` opens a plain guest connection (no
SASL); `Redial` repeats the last dial as it was; `Hangup` closes the
socket deliberately (no auto-reconnect); `DisarmReconnect` keeps a
closed step on the gate instead of reconnecting as a guest;
`ParkJoin`/`UnparkJoin` hold a pending `?join=` room while a guest
socket that is not the person's session is open.
-}
type Effect
    = Dial
    | Redial
    | Send String
    | SolvePow String
    | IdentifyHeld { account : String, code : String }
    | StartPasskey String
    | Hangup
    | DisarmReconnect
    | ForgetCredential
    | ToSignIn { account : String, recovery : Bool }
    | ParkJoin
    | UnparkJoin



-- QUERIES


{-| An auth step owns the whole gate (it replaces the connect form). -}
takesOver : State -> Bool
takesOver state =
    case state.challenge of
        QuestionAsked _ ->
            True

        ChallengeStopped _ ->
            True

        _ ->
            state.flow /= NoFlow


{-| The element the gate should focus when its panel changes: the
first field of a form step, the primary button of a stop/done step,
the heading of the passkey wait. `Nothing` while a step is busy (its
field is disabled), so focus returns to the field when it re-enables
after a refusal.
-}
panelFocus : State -> Maybe String
panelFocus state =
    case state.challenge of
        QuestionAsked asked ->
            if asked.sent then
                Nothing

            else
                Just "auth-answer"

        ChallengeStopped _ ->
            Just "auth-retry"

        _ ->
            case state.flow of
                NoFlow ->
                    Nothing

                TwoFactor _ TfaCode ->
                    Just "auth-code"

                TwoFactor _ _ ->
                    Nothing

                PasskeySignIn _ _ ->
                    Just "auth-title"

                Reset ResetAsk ->
                    Just "auth-reset-account"

                Reset ResetEnter ->
                    Just "auth-reset-code"

                Reset ResetDone ->
                    Just "auth-done"

                Reset _ ->
                    Nothing


flowAccount : State -> Maybe String
flowAccount state =
    case state.flow of
        TwoFactor account _ ->
            Just account

        PasskeySignIn account _ ->
            Just account

        Reset _ ->
            nonEmpty (String.trim state.resetAccount)

        NoFlow ->
            Nothing



-- UPDATE


update : Ctx -> Msg -> State -> ( State, List Effect )
update ctx msg state =
    case msg of
        CodeInput value ->
            ( { state | code = String.left 16 value, error = Nothing }, [] )

        CodeSubmit ->
            case state.flow of
                TwoFactor account TfaCode ->
                    case normalizeTotpCode state.code of
                        Nothing ->
                            ( { state | error = Just "Enter the 6-digit code from your authenticator app." }, [] )

                        Just code ->
                            if ctx.live then
                                ( { state | flow = TwoFactor account TfaVerifying, code = "", error = Nothing }
                                , [ IdentifyHeld { account = account, code = code } ]
                                )

                            else if ctx.socketOpen then
                                ( state, [] )

                            else
                                ( { state | flow = TwoFactor account TfaDialing, code = code, error = Nothing }
                                , [ ParkJoin, Dial ]
                                )

                _ ->
                    ( state, [] )

        UseRecoveryCode ->
            case state.flow of
                TwoFactor account _ ->
                    ( clearDrafts { state | flow = NoFlow }
                    , hangupIfOpen ctx ++ [ ForgetCredential, UnparkJoin, ToSignIn { account = account, recovery = True } ]
                    )

                _ ->
                    ( state, [] )

        AnswerInput value ->
            ( { state | answer = String.left 200 value }, [] )

        AnswerSubmit ->
            case state.challenge of
                QuestionAsked asked ->
                    if asked.sent then
                        ( state, [] )

                    else
                        case challengeAnswerLine state.answer of
                            Nothing ->
                                ( { state | challenge = QuestionAsked { asked | error = Just "Type an answer first (one line, up to 64 characters)." } }, [] )

                            Just line ->
                                ( { state | challenge = QuestionAsked { asked | sent = True, error = Nothing }, answer = "" }
                                , [ Send line ]
                                )

                _ ->
                    ( state, [] )

        ChallengeRetry ->
            case state.challenge of
                ChallengeStopped _ ->
                    ( { state | challenge = NoChallenge }, [ Redial ] )

                _ ->
                    ( state, [] )

        ChallengeDismiss ->
            ( { state | challenge = NoChallenge, answer = "" }, hangupIfOpen ctx )

        PasskeyStart ->
            case wireToken (String.trim ctx.signInNick) of
                Nothing ->
                    ( { state | error = Just "Enter your account name first, then choose passkey." }, [] )

                Just account ->
                    if ctx.socketOpen then
                        ( state, [] )

                    else
                        ( clearDrafts { state | flow = PasskeySignIn account PkDialing }
                        , [ ParkJoin, Dial ]
                        )

        PasskeyRetry ->
            case state.flow of
                PasskeySignIn account _ ->
                    if ctx.live then
                        ( { state | flow = PasskeySignIn account PkWaiting, error = Nothing }, [ StartPasskey account ] )

                    else if ctx.socketOpen then
                        ( state, [] )

                    else
                        ( { state | flow = PasskeySignIn account PkDialing, error = Nothing }, [ Dial ] )

                _ ->
                    ( state, [] )

        ResetOpen ->
            if ctx.socketOpen then
                ( state, [] )

            else
                ( clearDrafts { state | flow = Reset ResetAsk, resetAccount = String.trim ctx.signInNick }, [] )

        ResetAccountInput value ->
            ( { state | resetAccount = String.left 64 value, error = Nothing }, [] )

        ResetRequestSubmit ->
            case state.flow of
                Reset ResetAsk ->
                    case wireToken (String.trim state.resetAccount) of
                        Nothing ->
                            ( { state | error = Just "Enter your account name (no spaces)." }, [] )

                        Just account ->
                            let
                                asking =
                                    { state | flow = Reset ResetAsking, resetAccount = account, error = Nothing }
                            in
                            if ctx.live then
                                ( asking, [ Send (resetRequestLine account) ] )

                            else if ctx.socketOpen then
                                ( state, [] )

                            else
                                ( asking, [ ParkJoin, Dial ] )

                _ ->
                    ( state, [] )

        ResetHaveCode ->
            case state.flow of
                Reset ResetAsk ->
                    case wireToken (String.trim state.resetAccount) of
                        Nothing ->
                            ( { state | error = Just "Enter your account name (no spaces)." }, [] )

                        Just account ->
                            ( { state | flow = Reset ResetEnter, resetAccount = account, error = Nothing }, [] )

                _ ->
                    ( state, [] )

        ResetCodeInput value ->
            ( { state | resetCode = String.left 80 value, error = Nothing }, [] )

        ResetPasswordInput value ->
            ( { state | resetPassword = value, error = Nothing }, [] )

        ResetConfirmInput value ->
            ( { state | resetConfirm = value, error = Nothing }, [] )

        ResetConfirmSubmit ->
            case state.flow of
                Reset ResetEnter ->
                    case ( normalizeResetCode state.resetCode, validateNewPassword state.resetPassword ) of
                        ( Nothing, _ ) ->
                            ( { state | error = Just "Paste the 32-character reset code from the email." }, [] )

                        ( _, Just problem ) ->
                            ( { state | error = Just problem }, [] )

                        ( Just code, Nothing ) ->
                            if state.resetPassword /= state.resetConfirm then
                                ( { state | error = Just "The two new passwords don't match." }, [] )

                            else if ctx.live then
                                ( { state | flow = Reset ResetSetting, resetCode = code, resetPassword = "", resetConfirm = "", error = Nothing }
                                , [ Send (resetConfirmLine state.resetAccount code state.resetPassword) ]
                                )

                            else if ctx.socketOpen then
                                ( state, [] )

                            else
                                -- Held only until the guest socket
                                -- registers (`onRegistered` sends and
                                -- clears it).
                                ( { state | flow = Reset ResetSetting, resetCode = code, error = Nothing }
                                , [ ParkJoin, Dial ]
                                )

                _ ->
                    ( state, [] )

        ResetAgain ->
            case state.flow of
                Reset _ ->
                    ( { state | flow = Reset ResetAsk, resetCode = "", resetPassword = "", resetConfirm = "", error = Nothing }, [] )

                _ ->
                    ( state, [] )

        DoneSignIn ->
            case state.flow of
                Reset ResetDone ->
                    ( clearDrafts { state | flow = NoFlow }
                    , hangupIfOpen ctx ++ [ UnparkJoin, ToSignIn { account = state.resetAccount, recovery = False } ]
                    )

                _ ->
                    ( state, [] )

        Cancel ->
            case state.flow of
                NoFlow ->
                    ( state, [] )

                TwoFactor account _ ->
                    ( clearDrafts { state | flow = NoFlow }
                    , hangupIfOpen ctx ++ [ ForgetCredential, UnparkJoin, ToSignIn { account = account, recovery = False } ]
                    )

                PasskeySignIn account _ ->
                    ( clearDrafts { state | flow = NoFlow }
                    , hangupIfOpen ctx ++ [ UnparkJoin, ToSignIn { account = account, recovery = False } ]
                    )

                Reset _ ->
                    ( clearDrafts { state | flow = NoFlow }
                    , hangupIfOpen ctx ++ [ UnparkJoin, ToSignIn { account = state.resetAccount, recovery = False } ]
                    )


hangupIfOpen : Ctx -> List Effect
hangupIfOpen ctx =
    if ctx.socketOpen then
        [ Hangup ]

    else
        []


{-| Forget every secret-bearing draft (codes and passwords) and the
error line; the reset account name is not a secret and stays.
-}
clearDrafts : State -> State
clearDrafts state =
    { state | code = "", answer = "", resetCode = "", resetPassword = "", resetConfirm = "", error = Nothing }



-- WIRE EVENTS


type ChallengeNotice
    = ChallengePow String
    | ChallengeQuestion String
    | ChallengeFailed
    | ChallengeWait
    | ChallengeNotRequired


{-| The pre-001 server NOTICE bodies (`server.zig noticeChallenge`,
`handleChallenge`). Anything else is not a challenge line.
-}
parseChallengeNotice : String -> Maybe ChallengeNotice
parseChallengeNotice body =
    case String.words body of
        [ "CHALLENGE", "pow", seed ] ->
            Just (ChallengePow seed)

        "CHALLENGE" :: "question" :: _ ->
            let
                question =
                    String.trim (String.dropLeft (String.length "CHALLENGE question") (String.trimLeft body))
            in
            if String.isEmpty question then
                Nothing

            else
                Just (ChallengeQuestion (String.left maxQuestionChars question))

        [ "CHALLENGE", "failed" ] ->
            Just ChallengeFailed

        [ "CHALLENGE", "wait" ] ->
            Just ChallengeWait

        [ "CHALLENGE", "not", "required" ] ->
            Just ChallengeNotRequired

        _ ->
            Nothing


{-| `challenge.zig max_text`. -}
maxQuestionChars : Int
maxQuestionChars =
    160


{-| `challenge.zig max_answer` (bytes). -}
maxAnswerBytes : Int
maxAnswerBytes =
    64


onChallengeNotice : ChallengeNotice -> State -> ( State, List Effect )
onChallengeNotice notice state =
    case notice of
        ChallengePow seed ->
            if validSeed seed then
                ( { state | challenge = PowSolving (String.toLower seed) }, [ SolvePow (String.toLower seed) ] )

            else
                ( { state | challenge = ChallengeStopped StopPowRejected }, [ Hangup ] )

        ChallengeQuestion question ->
            ( { state | challenge = QuestionAsked { question = question, error = Nothing, sent = False }, answer = "" }, [] )

        ChallengeFailed ->
            case state.challenge of
                QuestionAsked asked ->
                    ( { state | challenge = QuestionAsked { asked | sent = False, error = Just "That answer wasn't accepted. Wait a few seconds, then try again." } }, [] )

                PowSolving _ ->
                    ( { state | challenge = ChallengeStopped StopPowRejected }, [ Hangup ] )

                PowSent ->
                    ( { state | challenge = ChallengeStopped StopPowRejected }, [ Hangup ] )

                _ ->
                    ( state, [] )

        ChallengeWait ->
            case state.challenge of
                QuestionAsked asked ->
                    ( { state | challenge = QuestionAsked { asked | sent = False, error = Just "Please wait a few seconds before answering again." } }, [] )

                PowSent ->
                    ( { state | challenge = ChallengeStopped StopPowRejected }, [ Hangup ] )

                _ ->
                    ( state, [] )

        ChallengeNotRequired ->
            ( { state | challenge = NoChallenge }, [] )


{-| The ports answered a `SolvePow` (an empty answer: no solution in
budget). Stale answers (another seed, or the challenge settled
meanwhile) are dropped.
-}
onPowSolved : String -> String -> State -> ( State, List Effect )
onPowSolved seed answer state =
    case state.challenge of
        PowSolving pending ->
            if pending /= String.toLower seed then
                ( state, [] )

            else
                case challengeAnswerLine answer of
                    Just line ->
                        ( { state | challenge = PowSent }, [ Send line ] )

                    Nothing ->
                        ( { state | challenge = ChallengeStopped StopPowRejected }, [ Hangup ] )

        _ ->
            ( state, [] )


{-| The current socket just registered (001): the challenge passed,
and a guest dial made for an auth step sends its command.
-}
onRegistered : State -> ( State, List Effect )
onRegistered state =
    let
        passed =
            { state | challenge = NoChallenge }
    in
    case state.flow of
        TwoFactor account TfaDialing ->
            case normalizeTotpCode state.code of
                Just code ->
                    ( { passed | flow = TwoFactor account TfaVerifying, code = "" }
                    , [ IdentifyHeld { account = account, code = code } ]
                    )

                Nothing ->
                    ( { passed | flow = TwoFactor account TfaCode, code = "" }, [] )

        PasskeySignIn account PkDialing ->
            ( { passed | flow = PasskeySignIn account PkWaiting }, [ StartPasskey account ] )

        Reset ResetAsking ->
            ( passed, [ Send (resetRequestLine passed.resetAccount) ] )

        Reset ResetSetting ->
            if String.isEmpty passed.resetPassword then
                ( { passed | flow = Reset ResetEnter }, [] )

            else
                ( { passed | resetPassword = "", resetConfirm = "" }
                , [ Send (resetConfirmLine passed.resetAccount passed.resetCode passed.resetPassword) ]
                )

        _ ->
            ( passed, [] )


{-| The socket closed. A question left unanswered timed out
(`registration_timeout_ms`, 30s by default); a step that needed the
socket goes back to its form with an honest line, and the gate keeps
the person (no auto-reconnect as a guest).
-}
onClosed : State -> ( State, List Effect )
onClosed state =
    let
        challenge =
            case state.challenge of
                QuestionAsked _ ->
                    ChallengeStopped StopTimedOut

                ChallengeStopped stop ->
                    ChallengeStopped stop

                _ ->
                    NoChallenge

        lost =
            Just "The connection closed before that finished. Try again."

        settled =
            { state | challenge = challenge }
    in
    case state.flow of
        NoFlow ->
            ( settled, [] )

        TwoFactor account TfaCode ->
            ( { settled | flow = TwoFactor account TfaCode }, [ DisarmReconnect ] )

        TwoFactor account _ ->
            ( { settled | flow = TwoFactor account TfaCode, code = "", error = lost }, [ DisarmReconnect ] )

        PasskeySignIn account PkStopped ->
            ( { settled | flow = PasskeySignIn account PkStopped }, [ DisarmReconnect ] )

        PasskeySignIn account _ ->
            ( { settled | flow = PasskeySignIn account PkStopped, error = lost }, [ DisarmReconnect ] )

        Reset ResetAsking ->
            ( { settled | flow = Reset ResetAsk, error = lost }, [ DisarmReconnect ] )

        Reset ResetSetting ->
            ( { settled | flow = Reset ResetEnter, resetPassword = "", resetConfirm = "", error = lost }, [ DisarmReconnect ] )

        Reset _ ->
            ( settled, [ DisarmReconnect ] )


{-| SASL ended in the two-factor 904: ask for the code. -}
onTwoFactorRefused : String -> State -> ( State, List Effect )
onTwoFactorRefused account state =
    ( clearDrafts { state | flow = TwoFactor account TfaCode }, [ DisarmReconnect ] )


{-| The server confirmed an IDENTIFY / passkey login. -}
onIdentified : State -> ( State, List Effect )
onIdentified state =
    case state.flow of
        TwoFactor _ _ ->
            ( clearDrafts { state | flow = NoFlow }, [ UnparkJoin ] )

        PasskeySignIn _ _ ->
            ( clearDrafts { state | flow = NoFlow }, [ UnparkJoin ] )

        _ ->
            ( state, [] )


{-| A refused two-step IDENTIFY (`FAIL IDENTIFY <code>` or a 464), or
a refused passkey login: back to the step with the reason.
-}
onIdentifyFailed : { code : String, text : String } -> State -> State
onIdentifyFailed failure state =
    case state.flow of
        TwoFactor account _ ->
            { state | flow = TwoFactor account TfaCode, code = "", error = Just (identifyFailCopy failure) }

        PasskeySignIn account _ ->
            { state | flow = PasskeySignIn account PkStopped, error = Just (identifyFailCopy failure) }

        _ ->
            state


{-| The generic `RESETPASS:` request NOTICE (sent whether or not the
account exists, so it never confirms one). -}
onResetRequested : State -> State
onResetRequested state =
    case state.flow of
        Reset ResetAsking ->
            { state | flow = Reset ResetEnter, error = Nothing }

        _ ->
            state


onResetSuccess : State -> State
onResetSuccess state =
    case state.flow of
        Reset _ ->
            { state | flow = Reset ResetDone, resetCode = "", resetPassword = "", resetConfirm = "", error = Nothing }

        _ ->
            state


{-| Every `FAIL RESETPASS` code (`server.zig handleResetpass`). A code
that was accepted before the password was refused is spent, so those
land back on the request step.
-}
onResetFail : { code : String, text : String } -> State -> State
onResetFail failure state =
    case state.flow of
        Reset phase ->
            let
                back =
                    case failure.code of
                        "BAD_CODE" ->
                            ResetEnter

                        "EXPIRED" ->
                            ResetAsk

                        "NO_REQUEST" ->
                            ResetAsk

                        "TOO_MANY_ATTEMPTS" ->
                            ResetAsk

                        "INVALID_PASSWORD" ->
                            ResetAsk

                        "UNAVAILABLE" ->
                            ResetAsk

                        _ ->
                            case phase of
                                ResetSetting ->
                                    ResetEnter

                                ResetAsking ->
                                    ResetAsk

                                other ->
                                    other
            in
            { state
                | flow = Reset back
                , resetCode =
                    if back == ResetEnter then
                        state.resetCode

                    else
                        ""
                , resetPassword = ""
                , resetConfirm = ""
                , error = Just (resetFailCopy failure)
            }

        _ ->
            state



-- PARSERS


{-| The 904 text that means "this account needs its second factor"
(`dispatch.zig`: "Two-factor authentication required: log in with
IDENTIFY <account> <password> <code>").
-}
isTwoFactorRefusal : String -> Bool
isTwoFactorRefusal text =
    let
        lower =
            String.toLower text
    in
    String.contains "two-factor" lower
        || String.contains "2fa" lower
        || (String.contains "identify" lower && String.contains "code" lower)


{-| `NOTICE <me> :You are now identified as <account>` — the IDENTIFY
and passkey login confirmation (`server.zig handleIdentify`,
`webauthnAuthFinish`); the server sends no 900 for either.
-}
identifiedAccount : String -> Maybe String
identifiedAccount body =
    case String.words body of
        [ "You", "are", "now", "identified", "as", account ] ->
            wireToken account

        _ ->
            Nothing


{-| The SETPASS success NOTICE bodies (`server.zig handleSetpass`). -}
setPassNotice : String -> Bool
setPassNotice body =
    String.startsWith "SETPASS: your password has been " body


{-| `RESETPASS: if that account has a verified email, a reset code has
been sent.` (`server.zig resetGenericReply`).
-}
isResetRequestNotice : String -> Bool
isResetRequestNotice body =
    String.startsWith "RESETPASS: " body && String.contains "reset code" body


{-| A standard reply that reached a client without `standard-replies`
as `NOTICE <me> :FAIL <CMD> <CODE>: <text>` (`server.zig failReply`).
-}
noticeStandardReply : String -> Maybe { kind : String, command : String, code : String, text : String }
noticeStandardReply body =
    case String.words body of
        kind :: command :: rawCode :: _ ->
            if (kind == "FAIL" || kind == "WARN" || kind == "NOTE") && String.endsWith ":" rawCode then
                let
                    prefix =
                        kind ++ " " ++ command ++ " " ++ rawCode
                in
                Just
                    { kind = kind
                    , command = command
                    , code = String.dropRight 1 rawCode
                    , text = String.trim (String.dropLeft (String.length prefix) (String.trimLeft body))
                    }

            else
                Nothing

        _ ->
            Nothing


{-| A TOTP code: digits only once spaces/dashes are dropped, 6 to 8 of
them (`totp.verify` checks the RFC 6238 6-digit code).
-}
normalizeTotpCode : String -> Maybe String
normalizeTotpCode raw =
    let
        digits =
            String.filter (\c -> c /= ' ' && c /= '-') raw
    in
    if String.length digits >= 6 && String.length digits <= 8 && String.all Char.isDigit digits then
        Just digits

    else
        Nothing


{-| A reset code: 32 hex characters (16 random bytes, lowercase hex on
the server); whitespace and dashes from a copy-paste are dropped.
-}
normalizeResetCode : String -> Maybe String
normalizeResetCode raw =
    let
        compact =
            String.toLower (String.filter (\c -> c /= ' ' && c /= '-' && c /= '\n' && c /= '\t') raw)
    in
    if String.length compact == 32 && String.all Char.isHexDigit compact then
        Just compact

    else
        Nothing


{-| The server's password policy for SETPASS/RESETPASS: 8 to 512
bytes, no control characters (`Nothing` = acceptable).
-}
validateNewPassword : String -> Maybe String
validateNewPassword value =
    if String.isEmpty value then
        Just "Choose a new password."

    else if String.length value < 8 then
        Just "Use at least 8 characters."

    else if utf8Bytes value > 512 then
        Just "That password is too long (512 bytes at most)."

    else if String.any (\c -> Char.toCode c < 32 || Char.toCode c == 127) value then
        Just "Passwords can't contain control characters."

    else
        Nothing


utf8Bytes : String -> Int
utf8Bytes value =
    String.foldl
        (\c n ->
            let
                code =
                    Char.toCode c
            in
            n
                + (if code < 0x80 then
                    1

                   else if code < 0x0800 then
                    2

                   else if code < 0x00010000 then
                    3

                   else
                    4
                  )
        )
        0
        value


{-| A middle IRC parameter: non-empty, no spaces or control
characters, not starting with `:`, at most 64 characters. -}
wireToken : String -> Maybe String
wireToken value =
    if String.isEmpty value || String.length value > 64 || String.startsWith ":" value then
        Nothing

    else if String.any (\c -> Char.toCode c <= 32 || Char.toCode c == 127) value then
        Nothing

    else
        Just value


validSeed : String -> Bool
validSeed seed =
    String.length seed >= 2 && String.length seed <= 64 && modBy 2 (String.length seed) == 0 && String.all Char.isHexDigit seed


{-| A temporary connection nick for an auth step, never the account
name (`Guest` + 5 digits from the clock). -}
guestNick : Float -> String
guestNick nowMs =
    "Guest" ++ String.fromInt (10000 + modBy 90000 (abs (round nowMs // 7)))



-- LINES


{-| `CHALLENGE <answer>`: one line, 1..64 bytes, no control
characters (`challenge.zig admit`); a multi-word answer rides the
trailing parameter.
-}
challengeAnswerLine : String -> Maybe String
challengeAnswerLine raw =
    let
        answer =
            String.trim raw
    in
    if String.isEmpty answer || utf8Bytes answer > maxAnswerBytes then
        Nothing

    else if String.any (\c -> Char.toCode c < 32 || Char.toCode c == 127) answer then
        Nothing

    else
        Just (Wire.formatIrcLine "CHALLENGE" [ answer ])


resetRequestLine : String -> String
resetRequestLine account =
    Wire.formatIrcLine "RESETPASS" [ account ]


{-| `RESETPASS <account> <code> :<new-password>` — the new password is
always the trailing parameter, so spaces survive and a value that
merely looks like a token is never re-split.
-}
resetConfirmLine : String -> String -> String -> String
resetConfirmLine account code password =
    "RESETPASS " ++ account ++ " " ++ code ++ " :" ++ password ++ "\u{000D}\n"



-- COPY


{-| `FAIL IDENTIFY` codes, the 464 login refusals, and the ports-side
refusals of the held-password IDENTIFY. -}
identifyFailCopy : { code : String, text : String } -> String
identifyFailCopy failure =
    case failure.code of
        "TOTP_REQUIRED" ->
            "That code didn't work. Codes change every 30 seconds — enter the newest one."

        "TEMPORARILY_UNAVAILABLE" ->
            "Sign-in is unavailable right now. Try again in a few minutes."

        "464" ->
            if String.startsWith "Too many failed login attempts" failure.text then
                "Too many sign-in attempts. " ++ retryTail failure.text

            else
                "Your password wasn't accepted. Go back and sign in again."

        "NO_PASSWORD" ->
            "Go back and sign in with your password again, then enter a code."

        "UNSAFE_PASSWORD" ->
            "This password contains a space, which two-step sign-in can't send. Use a recovery code, or reset your password."

        "TOO_LONG" ->
            "This password is too long for two-step sign-in to send. Use a recovery code, or reset your password."

        _ ->
            orCode failure "Sign-in failed"


retryTail : String -> String
retryTail text =
    case String.indexes "retry in " text of
        at :: _ ->
            "Try again in " ++ String.dropLeft (at + 9) text ++ "."

        [] ->
            "Wait a little, then try again."


{-| `FAIL RESETPASS` codes (`server.zig handleResetpass`). -}
resetFailCopy : { code : String, text : String } -> String
resetFailCopy failure =
    case failure.code of
        "BAD_CODE" ->
            "That code isn't right. Check the email and try again."

        "EXPIRED" ->
            "That code has expired. Request a new one."

        "NO_REQUEST" ->
            "There's no reset waiting for that account. Request a code first."

        "TOO_MANY_ATTEMPTS" ->
            "Too many incorrect codes. Request a new one."

        "INVALID_PASSWORD" ->
            "That password wasn't accepted (use 8 to 512 characters), and the code is now used up. Request a new code."

        "UNAVAILABLE" ->
            "Email password reset isn't set up on this network. If you saved recovery codes, sign in with one instead."

        "TEMPORARILY_UNAVAILABLE" ->
            "Password reset is unavailable right now. Try again in a few minutes."

        _ ->
            orCode failure "Password reset failed"


{-| `FAIL SETPASS` codes (`server.zig handleSetpass`). -}
setPassFailCopy : { code : String, text : String } -> String
setPassFailCopy failure =
    case failure.code of
        "WRONG_PASSWORD" ->
            "Your current password isn't right."

        "INVALID_PASSWORD" ->
            "Choose a new password of 8 to 512 characters that's different from your current one."

        "ACCOUNT_REQUIRED" ->
            "Sign in to change your password."

        "RESET_NOT_AUTHORIZED" ->
            "Enter your current password to change it."

        "TEMPORARILY_UNAVAILABLE" ->
            "Password changes are unavailable right now. Try again in a few minutes."

        "UNSAFE_PASSWORD" ->
            "Your current password contains a space, which this command can't send. Reset your password by email instead."

        _ ->
            orCode failure "Password change failed"


orCode : { code : String, text : String } -> String -> String
orCode failure lead =
    if String.isEmpty (String.trim failure.text) then
        lead ++ " (" ++ failure.code ++ ")."

    else
        failure.text


{-| `WEBAUTHN STATUS :<n> passkey(s) registered` in plain words. -}
passkeyStatusCopy : String -> String
passkeyStatusCopy description =
    case String.words description |> List.head |> Maybe.andThen String.toInt of
        Just 0 ->
            "No passkeys are on file for this account."

        Just 1 ->
            "1 passkey is on file for this account."

        Just n ->
            String.fromInt n ++ " passkeys are on file for this account."

        Nothing ->
            description


nonEmpty : String -> Maybe String
nonEmpty value =
    if String.isEmpty value then
        Nothing

    else
        Just value
