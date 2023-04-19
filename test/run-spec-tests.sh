#!/bin/bash -e
root=`cd \`dirname $0\`; pwd`

BUILD=$root/build
OUT=$BUILD/out
test -d bundler-spec-tests || git clone https://github.com/eth-infinitism/bundler-spec-tests.git spec-tests/bundler-spec-tests

launcher="`pwd`/spec-tests/alto-launcher.sh"

cd spec-tests/bundler-spec-tests 

#first time must runall.
test -d .venv || runall=1
if [ -n "$runall" ]; then
git pull
pdm install
pdm update-deps
fi

rm -rf $OUT
mkdir -p $OUT

#skip folders
test -d $launcher && continue

echo ====================================================================
echo ====== `basename $launcher`
echo ====================================================================

basename=`basename -s .sh $launcher`
outxml=$OUT/$basename.xml
outjson=$OUT/$basename.json
outraw=$OUT/$basename.txt

name=`$launcher name`
echo "Running launcher $launcher, name=$name" > $outraw
OPTIONS="--launcher-script=$launcher --junit-xml $outxml"
OPTIONS="$OPTIONS -o junit_logging=all -o junit_log_passing_tests=false"
# --log-rpc
pdm run test -o junit_suite_name="$name" $OPTIONS "$@" | tee -a $outraw