module ConnectGate exposing
    ( Gate
    , Mode(..)
    , Phase(..)
    , arm
    , bodyCopy
    , modeKey
    , normalizeRoom
    , phase
    , statusLine
    , submitLabel
    , title
    )

{-| The connect gate: the first screen on `/app` for a visitor who
arrived without a pinned `?nick=`. It offers one primary path (join as
a guest under a chosen name, optionally into a room) with Sign in and
Create account as secondary modes.

Ported from the v3 client (`c18b9591`, `View/Connect.elm` and its
`App.elm` block, itself a port of `Connect.tsx`). Adapted to today's
runtime-owned credentials:

  - The socket still dials as a guest at boot. The gate sits in front of
    the shell and every choice reuses an existing in-session flow: a
    chosen name is a confirmed `NICK` change (the connection dialog's
    path), Sign in is the runtime `IDENTIFY` (`PrivateIdentifyRequested`;
    the password stays in the DOM field and the runtime reads and clears
    it), and Create account hands off to the guest-claim sheet whose
    passwords live in the runtime's private form outside `#app`.
  - Nothing in this record ever holds a password.

`pending` is the chosen name awaiting the network's confirmation; the
gate closes when it lands (or when an account signs in).

-}


type Mode
    = Guest
    | SignIn
    | Register


type alias Gate =
    { mode : Mode
    , name : String
    , room : String
    , error : Maybe String
    , pending : Maybe String
    }


arm : Gate
arm =
    { mode = Guest
    , name = ""
    , room = ""
    , error = Nothing
    , pending = Nothing
    }


modeKey : Mode -> String
modeKey mode =
    case mode of
        Guest ->
            "guest"

        SignIn ->
            "signin"

        Register ->
            "register"


title : Mode -> String
title mode =
    case mode of
        Guest ->
            "Join Onyx"

        SignIn ->
            "Sign in"

        Register ->
            "Create an account"


bodyCopy : Mode -> String
bodyCopy mode =
    case mode of
        Guest ->
            "Pick the name people will see. You can keep it with an account later."

        SignIn ->
            "Use the account name and password you already have on Onyx."

        Register ->
            "Choose the name to keep. Your password goes into a private form in the next step."


{-| Where the dial stands, as the gate shows it. -}
type Phase
    = Connecting
    | Ready
    | Unreachable
    | Waiting


phase : { live : Bool, registering : Bool, busy : Bool } -> Phase
phase input =
    if input.busy then
        Waiting

    else if input.live then
        Ready

    else if input.registering then
        Connecting

    else
        Unreachable


submitLabel : Mode -> Phase -> String
submitLabel mode current =
    case current of
        Connecting ->
            "Connecting…"

        Waiting ->
            case mode of
                SignIn ->
                    "Signing in…"

                _ ->
                    "Waiting for confirmation…"

        _ ->
            case mode of
                Guest ->
                    "Join"

                SignIn ->
                    "Sign in"

                Register ->
                    "Continue"


{-| Polite status copy. Failure types never name a server. -}
statusLine : Mode -> Phase -> Int -> String
statusLine mode current reconnectIn =
    case current of
        Connecting ->
            "Connecting to Onyx…"

        Unreachable ->
            if reconnectIn > 0 then
                "Onyx is unreachable right now. Trying again in " ++ String.fromInt reconnectIn ++ " seconds."

            else
                "Onyx is unreachable right now. Try again when you are ready."

        Waiting ->
            case mode of
                SignIn ->
                    "Checking your account…"

                _ ->
                    "Asking the network for that name…"

        Ready ->
            case mode of
                Guest ->
                    "Connected. Choose a name, or leave it blank to keep the one you have."

                SignIn ->
                    "Connected. Enter your account details."

                Register ->
                    "Connected. Choose the name your account will keep."


{-| Blank is `Ok Nothing`; a bare name gains its `#`; anything with
spaces, commas or control characters is refused. -}
normalizeRoom : String -> Result String (Maybe String)
normalizeRoom raw =
    let
        trimmed =
            String.trim raw

        prefixed =
            if String.startsWith "#" trimmed || String.startsWith "&" trimmed then
                trimmed

            else
                "#" ++ trimmed

        bad char =
            let
                code =
                    Char.toCode char
            in
            code <= 32 || code == 127 || char == ',' || char == '\u{0007}'
    in
    if String.isEmpty trimmed then
        Ok Nothing

    else if String.length prefixed < 2 || String.length prefixed > 64 || String.any bad prefixed then
        Err "Use a room name without spaces or commas, like #lounge."

    else
        Ok (Just prefixed)
