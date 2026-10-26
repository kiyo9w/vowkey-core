#!/bin/sh

if [ -n "${UMASK}" ]; then
    umask "${UMASK}"
fi

if [ -r /etc/vowkey.sh ]; then
    . /etc/vowkey.sh
elif [ -r /etc/vowkey_rs.sh ]; then
    echo "### You are using the old /etc/vowkey_rs.sh script, please migrate to /etc/vowkey.sh ###"
    . /etc/vowkey_rs.sh
fi

if [ -d /etc/vowkey.d ]; then
    for f in /etc/vowkey.d/*.sh; do
        if [ -r "${f}" ]; then
            . "${f}"
        fi
    done
elif [ -d /etc/vowkey_rs.d ]; then
    echo "### You are using the old /etc/vowkey_rs.d script directory, please migrate to /etc/vowkey.d ###"
    for f in /etc/vowkey_rs.d/*.sh; do
        if [ -r "${f}" ]; then
            . "${f}"
        fi
    done
fi

exec /vowkey "${@}"
